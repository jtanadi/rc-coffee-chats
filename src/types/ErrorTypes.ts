export interface IError {
  errorType: Errors;
  customMessage?: string;
}

export type Errors = 'INVALID_ZULIP_TOKEN';
