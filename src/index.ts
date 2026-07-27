import { mkdirSync, existsSync, unlinkSync } from "fs";
import { join } from "path";

const PORT = Number(Bun.env.PORT) || 3000;
const UPLOAD_DIR = Bun.env.UPLOAD_DIR || "./uploads";
const BASE_URL = Bun.env.BASE_URL || `http://localhost:${PORT}`;
const API_KEY = Bun.env.API_KEY || "";
const MAX_SIZE = Number(Bun.env.MAX_SIZE_MB || 100) * 1024 * 1024;

if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

function authed(req: Request): boolean {
  if (!API_KEY) return true;
  return req.headers.get("authorization") === `Bearer ${API_KEY}`;
}

function genName(original: string): string {
  const ext = original.includes(".") ? original.slice(original.lastIndexOf(".")) : "";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
}

const TOKEN_TTL = 5 * 60 * 1000;
const tokens = new Map<string, number>();

setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of tokens) if (exp < now) tokens.delete(k);
}, 60_000);

async function upload(req: Request, token?: string): Promise<Response> {
  if (!token && !authed(req)) return json({ error: "Unauthorized" }, 401);

  if (token) {
    const exp = tokens.get(token);
    if (exp === undefined || exp < Date.now()) {
      tokens.delete(token);
      return json({ error: "Invalid or expired token" }, 403);
    }
    tokens.delete(token);
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!file || !(file instanceof File))
    return json({ error: "Missing 'file' field" }, 400);

  if (file.size > MAX_SIZE)
    return json({ error: `File too large (max ${MAX_SIZE / 1024 / 1024}MB)` }, 413);

  const filename = genName(file.name);
  await Bun.write(join(UPLOAD_DIR, filename), file);

  return json({ url: `${BASE_URL}/uploads/${filename}` });
}

function presignedUrl(): Response {
  const token = crypto.randomUUID();
  tokens.set(token, Date.now() + TOKEN_TTL);
  return json({ url: `${BASE_URL}/upload?token=${token}` });
}

function del(req: Request, path: string): Response {
  if (!authed(req)) return json({ error: "Unauthorized" }, 401);

  const safe = path.replace(/\\/g, "/");
  if (safe.includes("..")) return json({ error: "Invalid path" }, 400);

  const fp = join(UPLOAD_DIR, safe);
  if (!existsSync(fp)) return json({ error: "Not found" }, 404);

  unlinkSync(fp);
  return json({ success: true });
}

function serve(path: string): Response {
  const safe = path.replace(/\\/g, "/");
  if (safe.includes("..")) return new Response("Forbidden", { status: 403 });

  const fp = join(UPLOAD_DIR, safe);
  if (!existsSync(fp)) return new Response("Not Found", { status: 404 });
  return new Response(Bun.file(fp));
}

const server = Bun.serve({
  port: PORT,
  maxRequestBodySize: MAX_SIZE + 1024,
  fetch(req) {
    const { pathname } = new URL(req.url);

    if (req.method === "POST" && pathname === "/upload") {
      const token = new URL(req.url).searchParams.get("token") ?? undefined;
      return upload(req, token);
    }
    if (req.method === "GET" && pathname === "/presigned-url") return presignedUrl();
    if (req.method === "DELETE" && pathname.startsWith("/file/")) return del(req, pathname.slice(6));
    if (pathname.startsWith("/uploads/")) return serve(pathname.slice(9));

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`cdx_media_uploader → ${server.url}`);
