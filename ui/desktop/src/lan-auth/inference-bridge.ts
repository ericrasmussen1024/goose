import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  INFERENCE_CHAT_PATH,
  INFERENCE_MODELS_PATH,
  MANAGED_MODEL,
  type InferenceBody,
  type LanAuthService,
} from './service';

const LOOPBACK = '127.0.0.1';
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;

function replyError(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify({ error: { message, type: 'gilbert_inference_error' } }));
}

async function readBody(request: IncomingMessage): Promise<string | null> {
  if (Number(request.headers['content-length']) > MAX_REQUEST_BYTES) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_REQUEST_BYTES) return null;
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

async function* streamBody(body: InferenceBody) {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function startInferenceBridge(
  auth: Pick<LanAuthService, 'inferenceSessionSignal' | 'requestInference'>
) {
  const key = randomBytes(32).toString('base64url');
  const expectedAuthorization = Buffer.from(`Bearer ${key}`);

  async function forward(request: IncomingMessage, response: ServerResponse) {
    const authorization = Buffer.from(request.headers.authorization ?? '');
    if (
      request.headers.host !== authority ||
      authorization.length !== expectedAuthorization.length ||
      !timingSafeEqual(authorization, expectedAuthorization)
    ) {
      replyError(response, 401, 'Invalid local Gilbert inference credential.');
      return;
    }

    const path = request.url;
    const isChat = path === INFERENCE_CHAT_PATH && request.method === 'POST';
    const isModels = path === INFERENCE_MODELS_PATH && request.method === 'GET';
    if (!isChat && !isModels) {
      replyError(response, 404, 'Unknown Gilbert inference endpoint.');
      return;
    }

    const sessionSignal = auth.inferenceSessionSignal();
    if (!sessionSignal) {
      replyError(response, 401, 'Sign in to Gilbert to use the managed model.');
      return;
    }

    const abort = new AbortController();
    response.once('close', () => abort.abort());
    const body = isChat ? await readBody(request) : undefined;
    if (body === null) {
      response.setHeader('Connection', 'close');
      replyError(response, 413, 'Gilbert inference request is too large.');
      return;
    }
    const signal = AbortSignal.any([abort.signal, sessionSignal]);
    const upstream = await auth.requestInference(path, signal, body);
    if (!upstream) {
      replyError(response, 401, 'Sign in to Gilbert to use the managed model.');
      return;
    }

    const type = upstream.headers.get('Content-Type') ?? 'application/json';
    const retryAfter = upstream.headers.get('Retry-After');
    if (retryAfter !== null) response.setHeader('Retry-After', retryAfter);
    response.writeHead(upstream.status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    response.flushHeaders();
    if (upstream.body) {
      await pipeline(Readable.from(streamBody(upstream.body)), response, { signal });
    } else {
      response.end();
    }
  }

  const server = createServer((request, response) => {
    void forward(request, response).catch(() => {
      if (response.destroyed) return;
      if (response.headersSent) response.destroy();
      else replyError(response, 502, 'Could not reach the Gilbert model gateway.');
    });
  });
  const authority = await new Promise<string>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, LOOPBACK, () => {
      server.off('error', reject);
      resolve(`${LOOPBACK}:${(server.address() as AddressInfo).port}`);
    });
  });

  const configuredNoProxy = process.env.no_proxy || process.env.NO_PROXY;
  const noProxy =
    configuredNoProxy === '*' ? '*' : [configuredNoProxy, LOOPBACK].filter(Boolean).join(',');
  return {
    env: {
      GILBERT_MANAGED_INFERENCE: '1',
      GOOSE_PROVIDER: 'openai',
      GOOSE_MODEL: MANAGED_MODEL,
      OPENAI_HOST: `http://${authority}`,
      OPENAI_BASE_PATH: INFERENCE_CHAT_PATH.slice(1),
      OPENAI_API_KEY: key,
      OPENAI_CUSTOM_HEADERS: '',
      NO_PROXY: noProxy,
      no_proxy: noProxy,
    },
    close() {
      server.close();
      server.closeAllConnections();
    },
  };
}
