import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/backend-config";

export async function POST(req: NextRequest) {
  const { username, password } = (await req.json()) as { username?: string; password?: string };

  let token: string;
  try {
    const res = await fetch(`${getApiBaseUrl()}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const json = (await res.json()) as { data?: { token?: string } };
    token = json.data?.token ?? "";
    if (!token) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Backend unavailable" }, { status: 502 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("nlc-token", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
