/**
 * Bulk Listing Operation Types
 */

// =============================================================================
// BULK OPERATION
// =============================================================================

export type BulkOpType = 'pause' | 'resume' | 'delete' | 'price_update';
export type BulkOpStatus = 'running' | 'completed' | 'failed';

export interface BulkOperation {
  id: string;
  user_id: string;
  type: BulkOpType;
  status: BulkOpStatus;
  total: number;
  completed: number;
  failed: number;
  errors: BulkError[];
  created_at: number;
  completed_at: number | null;
}

export interface BulkError {
  listing_id: string;
  error: string;
}

// =============================================================================
// BULK FILTER
// =============================================================================

export interface BulkFilter {
  /** Filter by listing status */
  status?: string;
  /** Filter by platform */
  platform?: string;
  /** Filter by product category */
  category?: string;
  /** Filter by creation date range (ms timestamps) */
  created_after?: number;
  created_before?: number;
  /** Filter by price range */
  min_price?: number;
  max_price?: number;
  /** Limit number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// =============================================================================
// BULK RESULT
// =============================================================================

export interface BulkResult {
  /** The bulk operation record */
  operation: BulkOperation;
  /** Individual results per listing */
  results: BulkItemResult[];
}

export interface BulkItemResult {
  listing_id: string;
  success: boolean;
  old_value?: string | number;
  new_value?: string | number;
  error?: string;
}

// =============================================================================
// PRICE UPDATE
// =============================================================================

export interface PriceUpdate {
  listing_id: string;
  new_price: number;
}
