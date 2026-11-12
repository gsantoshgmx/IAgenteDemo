import { createClaudeMiddleware } from "../../claude-server.js";

const handler = createClaudeMiddleware({ root: process.cwd(), serverless: true });

export default function handleClaude(request, response) {
  return handler(request, response, () => {
    response.statusCode = 404;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ error: "Ruta de Claude no encontrada." }));
  });
}