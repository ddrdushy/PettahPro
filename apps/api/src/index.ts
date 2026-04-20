import { buildServer } from "./server.js";

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "0.0.0.0";

const server = await buildServer();

try {
  await server.listen({ port, host });
  server.log.info(`PettahPro API listening on http://${host}:${port}`);
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
