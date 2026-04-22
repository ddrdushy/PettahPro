import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

// Custom roles + user-role assignment — roadmap #27 (tenant-admin §3.4).
//
// v1 is the catalog + assignment surface. Permissions live as a JSONB
// object on the role ({"invoices.create": true, ...}); enforcement
// at the route layer is a follow-up. Owners (users.is_owner) always
// pass every check — assigning a role to an owner is allowed but moot.
//
// System roles (is_system=true) are seeded per tenant by
// seed_admin_role_templates_for_tenant() and cannot be deleted or
// renamed by the UI. Their permission maps CAN be edited — admins
// sometimes want a tighter "Accountant" than the default.

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(64),
  description: z.string().max(2000).optional(),
  permissions: z.record(z.string(), z.boolean()).default({}),
});

const UpdateSchema = CreateSchema.partial();

function toRoleRow(r: typeof schema.roles.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    permissions: (r.permissions as Record<string, boolean>) ?? {},
    isSystem: r.isSystem,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export const rolesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /roles
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      return tx
        .select()
        .from(schema.roles)
        .where(and(eq(schema.roles.tenantId, ctx.tenantId), isNull(schema.roles.deletedAt)))
        .orderBy(desc(schema.roles.isSystem), schema.roles.name);
    });
    return reply.send({ roles: rows.map(toRoleRow) });
  });

  // POST /roles — create custom role
  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    try {
      const row = await withTenant(ctx.tenantId, async (tx) => {
        const [inserted] = await tx
          .insert(schema.roles)
          .values({
            tenantId: ctx.tenantId,
            name: parsed.data.name,
            description: parsed.data.description ?? null,
            permissions: parsed.data.permissions ?? {},
            isSystem: false,
          })
          .returning();
        return inserted;
      });
      return reply.send({ role: toRoleRow(row!) });
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("roles_tenant_name_unique")) {
        return reply.status(409).send({ error: { code: "DUPLICATE_NAME" } });
      }
      throw err;
    }
  });

  // PATCH /roles/:id — allowed on both custom and system roles (perms only
  // mutable on system; name/description locked).
  fastify.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.roles)
        .where(
          and(
            eq(schema.roles.tenantId, ctx.tenantId),
            eq(schema.roles.id, req.params.id),
            isNull(schema.roles.deletedAt),
          ),
        )
        .limit(1);
      if (!existing) return null;

      const patch: Partial<typeof schema.roles.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (existing.isSystem) {
        // On system roles only permissions are mutable.
        if (parsed.data.permissions !== undefined) patch.permissions = parsed.data.permissions;
      } else {
        if (parsed.data.name !== undefined) patch.name = parsed.data.name;
        if (parsed.data.description !== undefined)
          patch.description = parsed.data.description ?? null;
        if (parsed.data.permissions !== undefined) patch.permissions = parsed.data.permissions;
      }

      const [updated] = await tx
        .update(schema.roles)
        .set(patch)
        .where(
          and(
            eq(schema.roles.tenantId, ctx.tenantId),
            eq(schema.roles.id, req.params.id),
            isNull(schema.roles.deletedAt),
          ),
        )
        .returning();
      return updated;
    });

    if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({ role: toRoleRow(row) });
  });

  // DELETE /roles/:id — soft delete. System roles are locked.
  fastify.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const outcome = await withTenant(ctx.tenantId, async (tx) => {
      const [existing] = await tx
        .select({ id: schema.roles.id, isSystem: schema.roles.isSystem })
        .from(schema.roles)
        .where(
          and(
            eq(schema.roles.tenantId, ctx.tenantId),
            eq(schema.roles.id, req.params.id),
            isNull(schema.roles.deletedAt),
          ),
        )
        .limit(1);
      if (!existing) return { error: "NOT_FOUND" as const };
      if (existing.isSystem) return { error: "SYSTEM_ROLE" as const };

      await tx
        .update(schema.roles)
        .set({ deletedAt: new Date() })
        .where(eq(schema.roles.id, existing.id));
      // Cascade unassign — FK has ON DELETE CASCADE but since we soft-delete
      // the role, we also drop user_roles rows so effective perms change now.
      await tx.delete(schema.userRoles).where(eq(schema.userRoles.roleId, existing.id));
      return { ok: true as const };
    });

    if ("error" in outcome) {
      const code = outcome.error;
      const status = code === "NOT_FOUND" ? 404 : 409;
      return reply.status(status).send({ error: { code } });
    }
    return reply.send({ ok: true });
  });

  // GET /roles/users — list users in tenant with their roles.
  fastify.get("/users", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      return (await tx.execute(sql`
        SELECT u.id, u.email, u.full_name, u.is_owner, u.is_active,
          COALESCE(
            (
              SELECT json_agg(json_build_object('id', r.id, 'name', r.name) ORDER BY r.name)
              FROM user_roles ur
              JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
              WHERE ur.user_id = u.id AND ur.tenant_id = u.tenant_id
            ),
            '[]'::json
          ) AS roles
        FROM users u
        WHERE u.tenant_id = current_tenant_id() AND u.deleted_at IS NULL
        ORDER BY u.is_owner DESC, u.full_name ASC
      `)) as unknown as Array<{
        id: string;
        email: string;
        full_name: string | null;
        is_owner: boolean;
        is_active: boolean;
        roles: Array<{ id: string; name: string }>;
      }>;
    });

    return reply.send({
      users: rows.map((r) => ({
        id: r.id,
        email: r.email,
        fullName: r.full_name,
        isOwner: r.is_owner,
        isActive: r.is_active,
        roles: r.roles ?? [],
      })),
    });
  });

  // POST /roles/users/:userId/roles — assign a role.
  fastify.post<{ Params: { userId: string }; Body: { roleId: string } }>(
    "/users/:userId/roles",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const parsed = z.object({ roleId: z.string().uuid() }).safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
      }

      const outcome = await withTenant(ctx.tenantId, async (tx) => {
        // Verify user + role both exist in this tenant.
        const [user] = await tx
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(
            and(
              eq(schema.users.tenantId, ctx.tenantId),
              eq(schema.users.id, req.params.userId),
              isNull(schema.users.deletedAt),
            ),
          )
          .limit(1);
        if (!user) return { error: "USER_NOT_FOUND" as const };
        const [role] = await tx
          .select({ id: schema.roles.id })
          .from(schema.roles)
          .where(
            and(
              eq(schema.roles.tenantId, ctx.tenantId),
              eq(schema.roles.id, parsed.data.roleId),
              isNull(schema.roles.deletedAt),
            ),
          )
          .limit(1);
        if (!role) return { error: "ROLE_NOT_FOUND" as const };

        try {
          await tx.insert(schema.userRoles).values({
            tenantId: ctx.tenantId,
            userId: user.id,
            roleId: role.id,
            assignedByUserId: ctx.userId,
          });
        } catch (err) {
          const msg = (err as Error).message ?? "";
          if (msg.includes("user_roles_tenant_user_role_unique")) {
            // Idempotent — already assigned.
            return { ok: true as const };
          }
          throw err;
        }
        return { ok: true as const };
      });

      if ("error" in outcome) {
        return reply.status(404).send({ error: { code: outcome.error } });
      }
      return reply.send({ ok: true });
    },
  );

  // DELETE /roles/users/:userId/roles/:roleId — unassign.
  fastify.delete<{ Params: { userId: string; roleId: string } }>(
    "/users/:userId/roles/:roleId",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      await withTenant(ctx.tenantId, async (tx) => {
        await tx
          .delete(schema.userRoles)
          .where(
            and(
              eq(schema.userRoles.tenantId, ctx.tenantId),
              eq(schema.userRoles.userId, req.params.userId),
              eq(schema.userRoles.roleId, req.params.roleId),
            ),
          );
      });
      return reply.send({ ok: true });
    },
  );
};
