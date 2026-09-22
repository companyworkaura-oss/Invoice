/** Shape of every non-2xx JSON response returned by the API. */
export interface ApiErrorBody {
  error: string;
  details?: Record<string, string>;
}
