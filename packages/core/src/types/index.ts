import type { z } from "zod";
import type {
  BoardSchema,
  BoardIdSchema,
  CreateBoardSchema,
  UpdateBoardSchema,
} from "../schemas/board.js";
import type {
  CardSchema,
  CardIdSchema,
  CardWithTagsSchema,
  CreateCardSchema,
  UpdateCardSchema,
  MoveCardSchema,
  CardStatus,
} from "../schemas/card.js";
import type {
  CommentSchema,
  CommentIdSchema,
  CreateCommentSchema,
  CommentAuthor,
} from "../schemas/comment.js";
import type {
  ExecutionSchema,
  ExecutionIdSchema,
  ExecutionPhase,
  ExecutionStatus,
} from "../schemas/execution.js";
import type { ConfigSchema, ConfigInputSchema } from "../schemas/config.js";
import type { WSEventSchema } from "../schemas/ws-events.js";
import type { ClaudeStreamEventSchema } from "../schemas/claude.js";

// Branded ID types
export type BoardId = z.infer<typeof BoardIdSchema>;
export type CardId = z.infer<typeof CardIdSchema>;
export type CommentId = z.infer<typeof CommentIdSchema>;
export type ExecutionId = z.infer<typeof ExecutionIdSchema>;

// Board types
export type Board = z.infer<typeof BoardSchema>;
export type CreateBoard = z.infer<typeof CreateBoardSchema>;
export type UpdateBoard = z.infer<typeof UpdateBoardSchema>;

// Card types
export type Card = z.infer<typeof CardSchema>;
export type CardWithTags = z.infer<typeof CardWithTagsSchema>;
export type CreateCard = z.infer<typeof CreateCardSchema>;
export type UpdateCard = z.infer<typeof UpdateCardSchema>;
export type MoveCard = z.infer<typeof MoveCardSchema>;
export type CardStatusType = z.infer<typeof CardStatus>;

// Comment types
export type Comment = z.infer<typeof CommentSchema>;
export type CreateComment = z.infer<typeof CreateCommentSchema>;
export type CommentAuthorType = z.infer<typeof CommentAuthor>;

// Execution types
export type Execution = z.infer<typeof ExecutionSchema>;
export type ExecutionPhaseType = z.infer<typeof ExecutionPhase>;
export type ExecutionStatusType = z.infer<typeof ExecutionStatus>;

// Config types
export type Config = z.infer<typeof ConfigSchema>;
export type ConfigInput = z.infer<typeof ConfigInputSchema>;

// WebSocket types
export type WSEvent = z.infer<typeof WSEventSchema>;

// Claude types
export type ClaudeStreamEvent = z.infer<typeof ClaudeStreamEventSchema>;
