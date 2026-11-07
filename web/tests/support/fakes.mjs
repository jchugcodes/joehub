import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

export async function startFakeUpstash() {
  const token = "upstash-test-token";
  const values = new Map();
  const expires = new Map();
  const sets = new Map();
  const counts = { set: 0 };
  let fail = false;

  function live(key) {
    const at = expires.get(key);
    if (at && Date.now() >= at) {
      values.delete(key);
      expires.delete(key);
      return false;
    }
    return values.has(key) || sets.has(key);
  }

  function run(args) {
    const [op, key] = args;
    if (op === "GET") return live(key) ? values.get(key) : null;
    if (op === "SET") {
      counts.set += 1;
      values.set(key, args[2]);
      const ex = args.indexOf("EX");
      if (ex !== -1) expires.set(key, Date.now() + Number(args[ex + 1]) * 1000);
      return "OK";
    }
    if (op === "DEL") {
      values.delete(key);
      expires.delete(key);
      return 1;
    }
    if (op === "INCR") {
      const next = Number(live(key) ? values.get(key) : 0) + 1;
      values.set(key, String(next));
      return next;
    }
    if (op === "EXPIRE") {
      expires.set(key, Date.now() + Number(args[2]) * 1000);
      return 1;
    }
    if (op === "SADD") {
      const set = sets.get(key) || new Set();
      set.add(args[2]);
      sets.set(key, set);
      return 1;
    }
    if (op === "SMEMBERS") return [...(sets.get(key) || [])];
    throw new Error(`unexpected command ${op}`);
  }

  const server = createServer((request, response) => {
    if (fail) {
      response.writeHead(500);
      response.end(JSON.stringify({ error: "unavailable" }));
      return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        const result = run(JSON.parse(body));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ result }));
      } catch {
        response.writeHead(400);
        response.end(JSON.stringify({ error: "bad command" }));
      }
    });
  });
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    counts,
    setFail(value) {
      fail = value;
    },
    stop() {
      server.close();
    },
  };
}

export async function startFakeOidc({ clientId, clientSecret, sub, email }) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "test";
  jwk.alg = "RS256";
  jwk.use = "sig";
  const codes = new Map();
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/.well-known/openid-configuration") {
      const issuer = `http://127.0.0.1:${server.address().port}`;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        }),
      );
      return;
    }
    if (url.pathname === "/jwks") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (url.pathname === "/authorize") {
      const code = `code-${codes.size + 1}`;
      codes.set(code, {
        challenge: url.searchParams.get("code_challenge"),
        nonce: url.searchParams.get("nonce"),
        redirect: url.searchParams.get("redirect_uri"),
      });
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state") || "");
      response.writeHead(302, { location: back.toString() });
      response.end();
      return;
    }
    if (url.pathname === "/token" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const form = new URLSearchParams(body);
        const saved = codes.get(form.get("code"));
        const challenge = createHash("sha256").update(form.get("code_verifier") || "").digest("base64url");
        if (!saved || form.get("client_secret") !== clientSecret || challenge !== saved.challenge) {
          response.writeHead(400);
          response.end(JSON.stringify({ error: "invalid_grant" }));
          return;
        }
        codes.delete(form.get("code"));
        const issuer = `http://127.0.0.1:${server.address().port}`;
        const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test" })).toString("base64url");
        const payload = Buffer.from(
          JSON.stringify({
            iss: issuer,
            aud: clientId,
            sub,
            email,
            nonce: saved.nonce,
            exp: Math.floor(Date.now() / 1000) + 300,
          }),
        ).toString("base64url");
        const data = `${header}.${payload}`;
        const sig = createSign("RSA-SHA256").update(data).sign(privateKey).toString("base64url");
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id_token: `${data}.${sig}` }));
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const port = await listen(server);
  return {
    issuer: `http://127.0.0.1:${port}`,
    stop() {
      server.close();
    },
  };
}
