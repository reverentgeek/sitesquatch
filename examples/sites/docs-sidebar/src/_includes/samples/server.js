import { serve } from "pinecone";

serve({ port: 8080 }, (request) => {
  return new Response(`Hello from ${request.url}`);
});
