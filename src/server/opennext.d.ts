// Keep generated JavaScript outside TypeScript's checkJs graph while typing the adapter boundary.
declare module "*.open-next/worker.js" {
  const handler: {
    fetch(
      request: Request,
      env: unknown,
      ctx: ExecutionContext,
    ): Promise<Response>;
  };
  export default handler;
}
