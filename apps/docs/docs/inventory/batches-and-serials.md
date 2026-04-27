---
title: Batches and serials
sidebar_position: 6
---

# Batches and serials

## What it does

For some businesses, "we have 100 units of this item" isn't enough — you need to know **which 100 units**. Batches and serials are how PettahPro tracks individual units (or groups of units) through their full life: receipt, sale, return, write-off.

- **Batch tracking** is for items where units share an expiry date or supplier batch number — medicines, food, chemicals, anything with a shelf life. You track stock per batch; FIFO sales pick the oldest batch first.
- **Serial tracking** is for items where each unit has a unique identifier — phone IMEIs, appliance serials, vehicle VINs. You track stock unit by unit; sales record which exact serial went to which customer.

Both add overhead at receive time (you have to capture the batch / serial details) and at sale time (the system tracks which batch / serial leaves). The payoff: inventory you can trust at a level of detail regulators, customers, and warranty claims will need.

## Setting it up

On the item record (**Inventory → Items → \[item\]**), turn on either **Batch tracking** or **Serial tracking** (or both, in rare cases).

Once turned on, **every** subsequent receipt and sale of this item will require the batch / serial details. You can't go back to "untracked" once there's transaction history — start as you mean to continue.

For migrations: if you've been tracking batches in a previous system, the **Items → Import** flow accepts a CSV with batch details for each existing stock unit, so you don't lose history.

## Walkthrough — batches

### Receiving a batch

When posting a GRN for a batch-tracked item, the line expands to capture per-batch details:

- **Batch number** — usually printed on the supplier's package or the manufacturer's label.
- **Manufacture date** (optional) — helpful for FIFO and for shelf-life tracking.
- **Expiry date** — when the batch is no longer saleable.
- **Quantity in batch** — units of the item in this batch.
- **Supplier batch reference** (optional) — useful for recalls.

A single GRN line can split across multiple batches if the supplier shipped, say, 100 units across two production runs.

### Selling from a batch

When invoicing a batch-tracked item, the system picks the oldest batch (FIFO) by default:

- The line shows which batch is being drawn from.
- For items with multiple open batches, you can override and pick a specific batch (rare — usually FIFO is what you want).
- Once a batch is exhausted, sales draw from the next-oldest.

Sales of expired batches are blocked by default; you can override with manager permission. The sale records exactly which batch was drawn — useful if there's a complaint or recall later.

### Recall

Supplier announces a batch defect. Open **Inventory → Batches**, search for the batch number, see exactly: which units are still in stock, which have been sold (and to which customers). Take both actions in parallel:

- Pull remaining stock — post a stock adjustment writing off the affected units.
- Notify customers who received the batch — generate the contact list from the sales history.

### Expiry alerts

Set up **Settings → Inventory → Expiry alerts** to get notified when batches are within X days of expiring. Common settings: 90 days for medicine wholesalers, 14 days for food retailers. Alerts route to a designated user or to a Slack channel.

## Walkthrough — serials

### Receiving serials

When posting a GRN for a serial-tracked item, the line expands to take a list of serial numbers — one per unit. Three input modes:

- **Type each serial** — for small quantities.
- **Scan with a barcode reader** — for boxes of items where each has a printed serial.
- **Bulk paste from CSV** — for sequential serials (e.g. SN-001, SN-002, … SN-100).

Each serial is recorded with status **In stock**, linked to the GRN.

### Selling a serial

When invoicing a serial-tracked item, the line asks which specific serial is being sold. Three options:

- **Pick from list** — choose from in-stock serials.
- **Scan** — barcode the unit being sold; system looks it up.
- **Auto-pick FIFO** — system picks the longest-held serial (oldest receipt date).

The serial flips to **Sold**, linked to the invoice and the customer.

### Returns

When a customer returns a serial-tracked item, the credit note records which specific serial is coming back. The serial flips to **In stock** (or **Defective** if marked). Now selectable for sale to the next customer (or for a write-off).

### Tracking a specific unit

The customer calls about IMEI 9876... — what did we sell them, when, did we ship it? Open **Inventory → Serials**, search by serial number. The detail page shows the full history: receipt date, GRN number, supplier, sale date, invoice number, customer, current status. End-to-end traceability in one screen.

### Warranty claims

For items under warranty, when the customer returns one, you need to verify the serial is in your records (proves they bought from you), check the receipt date (warranty period), and route the unit either back to the supplier under warranty or to repair / write-off.

## Common tasks

### Convert a non-tracked item to batch-tracked

You can't retrofit batch tracking onto an item with existing transaction history. Two options:

- Create a new item with batch tracking on, transition over time as old stock sells through.
- For a bigger migration, contact PettahPro support — there's a one-time process to attach batch metadata to existing stock with proper audit.

### Bulk-import serials from a previous system

**Inventory → Serials → Import**. CSV with columns: item code, serial number, status, receipt date, supplier reference, customer reference (if sold). Useful for migrations.

### Print labels with serials

Each serial's label includes the unit's serial number plus a barcode. **Inventory → Labels → Configure** for the layout. Useful for items being shipped — the label on the box matches what's recorded in PettahPro.

### Block sale of expired batches

**Settings → Inventory → Batch sale rules** lets you choose: block expired batches at sale (strict), warn but allow (soft), or no enforcement. Pharmacy / food businesses typically run strict.

## What gets posted

Batches and serials don't change how the GL works. The journal entries on receipts and sales are the same as for non-tracked items — same accounts, same amounts.

What's different is the **inventory ledger**: each receipt and each sale records the specific batch or serial, so you can drill from any aggregate stock figure into per-batch or per-serial detail.

## FAQ

**Should I batch-track items that don't expire?**
Probably not — batch tracking is mostly about expiry. For non-expiring items where you still want supplier-batch traceability (say, electronic components), tracking can be worth it. For most items, no.

**Should I serial-track every item?**
Definitely not. Serial tracking adds friction to every receipt and every sale. Worth it for high-value items (phones, laptops, vehicles) where individual traceability matters; not worth it for low-value commodity items.

**Can a batch be transferred between warehouses?**
Yes — stock transfers carry batch identity. Batch X stays batch X, just at a different warehouse. The transfer screen lets you pick which batch is being moved if there are multiple.

**Two batches arrived on the same day with the same expiry — should I merge?**
Don't merge automatically — keep them as two batches with different supplier batch references. Useful if one batch later has a quality issue; you can isolate without affecting the other.

**A serial was lost or stolen. How do I record that?**
Stock adjustment for that specific serial. The serial flips to **Written off** with a reason; the adjustment posts the value to a "Stock loss" expense account on the P&L.

**FIFO doesn't work for my business — I always want to sell the newest first.**
Configurable per item — **FIFO** (oldest first), **LIFO** (newest first), or **Manual** (always pick at sale). LIFO is rare in SL practice (FIFO is the IRD standard) but supported.

## Related

- [Items](./items.md) — turn batch / serial tracking on per item.
- [Stock counts](./stock-counts.md) — counts capture per-batch / per-serial detail.
- [GRNs](../buy/grns.md) — where batches and serials are first captured.
- [Sell → Invoices](../sell/invoices.md) — where they're consumed.
- **Recall management** — workflow for batch defects.
