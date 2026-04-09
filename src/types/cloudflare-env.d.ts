declare global {
  interface D1Result {
    meta?: {
      changes?: number;
    };
  }

  interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = unknown>(): Promise<T | null>;
    run(): Promise<D1Result>;
  }

  interface D1Database {
    exec(query: string): Promise<unknown>;
    prepare(query: string): D1PreparedStatement;
  }

  interface CloudflareEnv {
    PHONE_USAGE_DB: D1Database;
    PHONE_USAGE_ADMIN_KEY?: string;
  }
}

export {};
