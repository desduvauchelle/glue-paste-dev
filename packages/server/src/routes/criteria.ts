import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import {
  criteriaDb,
  cardsDb,
  CreateCriterionSchema,
  UpdateCriterionSchema,
  ReorderCriteriaSchema,
} from "@glue-paste-dev/core";
import type { CardId, CriterionId } from "@glue-paste-dev/core";

export function criteriaRoutes(db: Database, broadcast: (event: unknown) => void) {
  const app = new Hono();

  function broadcastCard(cardId: CardId): void {
    const card = cardsDb.getCard(db, cardId);
    if (card) broadcast({ type: "card:updated", payload: card });
  }

  // POST /api/criteria/card/:cardId — add a manual criterion
  app.post("/card/:cardId", async (c) => {
    const body = await c.req.json();
    const parsed = CreateCriterionSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const cardId = c.req.param("cardId") as CardId;
    const criterion = criteriaDb.createCriterion(db, cardId, parsed.data.text);
    broadcastCard(cardId);
    return c.json(criterion, 201);
  });

  // PUT /api/criteria/:criterionId — edit text and/or status
  app.put("/:criterionId", async (c) => {
    const body = await c.req.json();
    const parsed = UpdateCriterionSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const id = c.req.param("criterionId") as CriterionId;
    const existing = criteriaDb.getCriterion(db, id);
    if (!existing) return c.json({ error: "Criterion not found" }, 404);
    const update: { text?: string; status?: "pending" | "pass" | "fail" } = {};
    if (parsed.data.text !== undefined) update.text = parsed.data.text;
    if (parsed.data.status !== undefined) update.status = parsed.data.status;
    const criterion = criteriaDb.updateCriterion(db, id, update);
    broadcastCard(existing.card_id as CardId);
    return c.json(criterion);
  });

  // DELETE /api/criteria/:criterionId
  app.delete("/:criterionId", (c) => {
    const id = c.req.param("criterionId") as CriterionId;
    const existing = criteriaDb.getCriterion(db, id);
    if (!existing) return c.json({ error: "Criterion not found" }, 404);
    criteriaDb.deleteCriterion(db, id);
    broadcastCard(existing.card_id as CardId);
    return c.json({ ok: true });
  });

  // PATCH /api/criteria/reorder
  app.patch("/reorder", async (c) => {
    const body = await c.req.json();
    const parsed = ReorderCriteriaSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    criteriaDb.reorderCriteria(db, parsed.data);
    const first = parsed.data[0];
    if (first) {
      const criterion = criteriaDb.getCriterion(db, first.id as CriterionId);
      if (criterion) broadcastCard(criterion.card_id as CardId);
    }
    return c.json({ ok: true });
  });

  return app;
}
