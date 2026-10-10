import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { CONFIG, DLT_MAP } from "../config.ts";
import { requireInstanceId } from "../db/index.ts";
import { appError } from "./errors.ts";
import { logDebug } from "./logger.ts";
import { makePcapGlobalHeader, wrapPcapPacket } from "./pcap.ts";
import type { UnixDgramSocket } from "unix-dgram";
import type { LabSpec } from "../types/index.ts";
import type { CaptureResult, CaptureSession, CaptureState, CaptureStream, NetioHeader, NetioProxy } from "../types/index.ts";

const STATE: CaptureState = {
  proxies: new Map(),
  sessions: new Map(),
  linkToSessions: new Map(),
  flowToSessions: new Map(),
};

const require = createRequire(import.meta.url);

let nextCaptureId = 1;
const freeCaptureIds: number[] = [];

function flowKey(header: NetioHeader): string {
  return `${header.srcInstanceId}:${header.srcIntf.slot}/${header.srcIntf.port}->${header.dstInstanceId}:${header.dstIntf.slot}/${header.dstIntf.port}`;
}

function resolveDlt(raw: string | undefined): number {
  if (!raw) return DLT_MAP.ethernet;
  const key = raw.toLowerCase();
  return DLT_MAP[key] ?? DLT_MAP.ethernet;
}

function ensureNetioSocket(instanceId: number): { socketPath: string; realPath: string } {
  const socketPath = path.join(CONFIG.netioDir, String(instanceId));
  const realPath = `${socketPath}_real`;
  if (!fs.existsSync(socketPath) && fs.existsSync(realPath)) {
    // 如果socketPath不存在但realPath存在，说明上次可能是因为崩溃导致代理未能正确清理，
    // 先将realPath恢复为socketPath以保证IOU通信正常，再由后续逻辑接管这个代理。
    fs.renameSync(realPath, socketPath);
  }
  if (!fs.existsSync(socketPath)) {
    throw appError("NETIO_NOT_FOUND", "Netio socket not found");
  }

  const stat = fs.statSync(socketPath);
  if (!stat.isSocket()) {
    throw appError("NETIO_NOT_FOUND", "Netio path is not a socket");
  }
  return { socketPath, realPath }; // 返回原始的socket路径和代理使用的真实路径
}

function parseNetioHeader(buf: Buffer): NetioHeader | null {
  // 处理Netio自定义的8字节头部，提取源和目的实例ID及接口信息
  if (buf.length < 8) return null;
  const dstInstanceId = buf.readUInt16BE(0);
  const srcInstanceId = buf.readUInt16BE(2);
  const dstByte = buf[4];
  const srcByte = buf[5];
  return {
    dstInstanceId,
    srcInstanceId,
    dstIntf: { slot: dstByte & 0x0f, port: (dstByte & 0xf0) >> 4 },
    srcIntf: { slot: srcByte & 0x0f, port: (srcByte & 0xf0) >> 4 },
  };
}


async function listenTcp(server: net.Server, port: number, host: string): Promise<void> {
  // 通过监听指定的端口和地址，等待客户端连接。一旦服务器开始监听，它将触发 'listening' 事件，表示服务器已准备好接受连接。
  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

async function createTcpStream(dlt: number, captureId: number): Promise<CaptureStream> {
  const server = net.createServer();
  const pcapHeader = makePcapGlobalHeader(dlt);
  let client: net.Socket | null = null;

  server.on("connection", (socket) => {
    if (client) {
      logDebug("capture", "client_rejected", { captureId, reason: "single-client-only" });
      socket.end();
      return;
    }
    client = socket;
    logDebug("capture", "client_connected", { captureId, remote: client.address() });

    client.on("end", () => {
      logDebug("capture", "client_end", { captureId });
    });

    client.on("error", (err) => {
      logDebug("capture", "client_error", { captureId, message: err.message });
      client = null;
    });

    client.write(pcapHeader);

    client.on("close", () => {
      logDebug("capture", "client_close", { captureId });
      client = null;
    });
  });

  server.on("error", (err) => {
    logDebug("capture", "server_error", { captureId, message: err.message });
  });

  server.on("close", () => {
    logDebug("capture", "server_close", { captureId });
  });

  const port = CONFIG.captureBasePort + captureId;
  await listenTcp(server, port, CONFIG.captureListenHost);
  const target = `tcp://${CONFIG.captureAdvertiseHost}:${port}`;

  logDebug("capture", "streaming", { captureId, target, dlt });

  return {
    type: "tcp",
    target,
    writePacket: (payload) => {
      if (!client) return;
      client.write(wrapPcapPacket(payload));
    },
    close: () => {
      if (client) client.end();
      server.close();
    },
  };
}

function allocateCaptureId(): number {
  if (freeCaptureIds.length > 0) {
    return freeCaptureIds.shift() as number;
  }
  if (nextCaptureId > CONFIG.maxCaptures) {
    throw appError("MAX_CAPTURES_REACHED", "Max active captures reached");
  }
  const captureId = nextCaptureId;
  nextCaptureId += 1;
  return captureId;
}

function releaseCaptureId(captureId: number): void {
  if (captureId <= 0 || captureId >= nextCaptureId) return;
  if (freeCaptureIds.includes(captureId)) return;
  freeCaptureIds.push(captureId);
  freeCaptureIds.sort((a, b) => a - b);
}

function createUnixDgramSocket(socketPath: string): NetioProxy["socket"] {
  try {
    const unixDgram = require("unix-dgram") as {
      createSocket: (type: "unix_dgram") => UnixDgramSocket;
    };
    const socket = unixDgram.createSocket("unix_dgram");
    socket.bind(socketPath);
    socket.on("error", (err: NodeJS.ErrnoException) => {
      // EAGAIN (-11): send buffer temporarily full — drop the packet silently.
      // Any other error is logged but not re-thrown to avoid crashing the process.
      if (err.errno !== -11) {
        logDebug("capture", "unix_dgram_error", { socketPath, code: err.errno, message: err.message });
      }
    });
    return socket;
  } catch {
    throw appError("UNIX_DGRAM_UNSUPPORTED", "UNIX datagram sockets are unavailable. Install `unix-dgram` to enable capture.");
  }
}

function ensureProxy(nodeId: string, instanceId: number): NetioProxy {
  const existing = STATE.proxies.get(nodeId);
  // 如果已经存在针对这个节点的代理，说明它已经在被至少一个捕获会话使用了。增加引用计数并复用这个代理。
  if (existing) {
    existing.refCount += 1;
    return existing;
  }

  const { socketPath, realPath } = ensureNetioSocket(instanceId);
  let socket: NetioProxy["socket"] | null = null;
  fs.renameSync(socketPath, realPath); // 将原始的IOU socket重命名为_real，腾出socketPath给代理使用
  try {
    socket = createUnixDgramSocket(socketPath);
  } catch (err) {
    if (fs.existsSync(realPath) && !fs.existsSync(socketPath)) {
      fs.renameSync(realPath, socketPath);
    }
    throw err;
  }

  const proxy: NetioProxy = {
    nodeId,
    instanceId,
    socketPath,
    realPath,
    socket,
    refCount: 1,
  };

  socket.on("message", (msg) => {
    socket.send(msg, 0, msg.length, proxy.realPath); // 将收到的消息转发给IOU的真实socket

    const header = parseNetioHeader(msg); // 解析Netio头部，提取流信息以便分发给对应的捕获会话
    if (!header) return;
    const key = flowKey(header); // 构造流的唯一标识符，格式为 "dstInstanceId:dstSlot/dstPort<-srcInstanceId:srcSlot/srcPort"
    const sessionIds = STATE.flowToSessions.get(key); // 查找有哪些捕获会话正在监听这个流
    if (!sessionIds) return;
    const payload = msg.subarray(8); // 去掉Netio头部的前8字节，剩下的就是原始数据包内容
    for (const sessionId of sessionIds) {
      const session = STATE.sessions.get(sessionId);
      if (!session) continue;
      session.stream.writePacket(payload); // 将数据包写入捕获会话的流中，最终会发送给连接的客户端
      for (const tap of session.packetTaps) tap(payload); // 触发会话的packet tap回调，供webviewer使用
    }
  });

  STATE.proxies.set(nodeId, proxy); // 将新创建的代理添加到全局状态中，以便后续捕获会话复用和管理
  return proxy;
}

function releaseProxy(nodeId: string): void {
  const proxy = STATE.proxies.get(nodeId);
  if (!proxy) return;
  proxy.refCount -= 1;
  if (proxy.refCount > 0) return; // 仍有其他捕获会话在使用这个代理，不能释放

  proxy.socket.close();
  if (fs.existsSync(proxy.socketPath)) fs.unlinkSync(proxy.socketPath); // 删除代理使用的socket路径
  if (fs.existsSync(proxy.realPath)) fs.renameSync(proxy.realPath, proxy.socketPath); // 将IOU的真实socket恢复到原来的路径，确保IOU通信不受影响
  STATE.proxies.delete(nodeId); // 从全局状态中移除这个代理
}

function registerFlow(flow: string, sessionId: number): void {
  const set = STATE.flowToSessions.get(flow) ?? new Set(); // 获取当前监听这个流的捕获会话集合，如果不存在则创建一个新的集合
  set.add(sessionId);
  STATE.flowToSessions.set(flow, set);
}

function unregisterFlow(flow: string, sessionId: number): void {
  const set = STATE.flowToSessions.get(flow);
  if (!set) return;
  set.delete(sessionId);
  if (set.size === 0) STATE.flowToSessions.delete(flow);
}

function registerLink(key: string, sessionId: number): void {
  const set = STATE.linkToSessions.get(key) ?? new Set();
  set.add(sessionId);
  STATE.linkToSessions.set(key, set);
}

function unregisterLink(key: string, sessionId: number): void {
  const set = STATE.linkToSessions.get(key);
  if (!set) return;
  set.delete(sessionId);
  if (set.size === 0) STATE.linkToSessions.delete(key);
}

export async function startCapture(spec: LabSpec, linkId: string, encap: string = "ethernet"): Promise<CaptureResult> {
  const labId = spec.lab.id;
  const link = spec.links?.find((item) => item.id === linkId);
  if (!link) {
    throw appError("LINK_NOT_FOUND", "Link not found");
  }
  if (link.kind === "veth") {
    throw appError("CAPTURE_UNSUPPORTED", "Cannot capture a container (veth) link");
  }
  const [aEndpoint, bEndpoint] = link.endpoints;
  if (!aEndpoint || !bEndpoint) {
    throw appError("INVALID_LINK", "Invalid link endpoints");
  }

  const sourceNodeId = link.source;
  const targetNodeId = link.target;
  const aNode = spec.nodes.find((node) => node.id === sourceNodeId);
  const bNode = spec.nodes.find((node) => node.id === targetNodeId);
  if (!aNode || !bNode) {
    throw appError("NODE_NOT_FOUND", "Node not found");
  }
  const instanceA = requireInstanceId(labId, sourceNodeId);
  const instanceB = requireInstanceId(labId, targetNodeId);
  const endpointA = {
    nodeId: sourceNodeId,
    instanceId: instanceA,
    intf: { slot: aEndpoint.slot, port: aEndpoint.port },
  };
  const endpointB = {
    nodeId: targetNodeId,
    instanceId: instanceB,
    intf: { slot: bEndpoint.slot, port: bEndpoint.port },
  };

  const dlt = resolveDlt(encap);
  const captureId = allocateCaptureId();

  let proxyA: NetioProxy | null = null;
  let proxyB: NetioProxy | null = null;
  let stream: CaptureStream | null = null;
  try {
    proxyA = ensureProxy(endpointA.nodeId, instanceA);
    // 如果两个端点在同一个节点上，复用同一个代理即可，无需为第二个端点创建新的代理
    proxyB = endpointA.nodeId === endpointB.nodeId ? proxyA : ensureProxy(endpointB.nodeId, instanceB);
    stream = await createTcpStream(dlt, captureId);
  } catch (err) {
    releaseCaptureId(captureId);
    if (proxyA) releaseProxy(proxyA.nodeId);
    if (proxyB && proxyB.nodeId !== proxyA?.nodeId) releaseProxy(proxyB.nodeId);
    throw err;
  }

  const session: CaptureSession = {
    id: captureId,
    labId,
    linkId,
    link: { a: endpointA, b: endpointB },
    dlt,
    stream: stream!,
    createdAt: Date.now(),
    packetTaps: new Set(),
  };

  STATE.sessions.set(captureId, session);
  registerLink(linkId, captureId);

  const flowAB = flowKey({
    dstInstanceId: instanceA,
    dstIntf: endpointA.intf,
    srcInstanceId: instanceB,
    srcIntf: endpointB.intf,
  });
  const flowBA = flowKey({
    dstInstanceId: instanceB,
    dstIntf: endpointB.intf,
    srcInstanceId: instanceA,
    srcIntf: endpointA.intf,
  });
  registerFlow(flowAB, captureId);
  registerFlow(flowBA, captureId);

  logDebug("capture", "capture_started", { captureId, labId, linkId, dlt, target: stream.target });

  return { captureId, captureUrl: stream.target, linkId, dlt };
}

export function stopCapture(labId: string, captureId: number): boolean {
  const session = STATE.sessions.get(captureId);
  if (!session || session.labId !== labId) return false;

  unregisterLink(session.linkId, captureId);

  const flowAB = flowKey({
    dstInstanceId: session.link.a.instanceId,
    dstIntf: session.link.a.intf,
    srcInstanceId: session.link.b.instanceId,
    srcIntf: session.link.b.intf,
  });
  const flowBA = flowKey({
    dstInstanceId: session.link.b.instanceId,
    dstIntf: session.link.b.intf,
    srcInstanceId: session.link.a.instanceId,
    srcIntf: session.link.a.intf,
  });
  unregisterFlow(flowAB, captureId);
  unregisterFlow(flowBA, captureId);

  session.stream.close();
  STATE.sessions.delete(captureId);
  releaseCaptureId(captureId);

  releaseProxy(session.link.a.nodeId);
  if (session.link.b.nodeId !== session.link.a.nodeId) {
    releaseProxy(session.link.b.nodeId);
  }

  logDebug("capture", "capture_stopped", {
    captureId,
    labId,
    linkId: session.linkId,
  });
  return true;
}

export function listCaptures(labId: string, linkId?: string): CaptureResult[] {
  let sessionIds: Iterable<number>;
  if (linkId) {
    sessionIds = STATE.linkToSessions.get(linkId) ?? new Set();
  } else {
    sessionIds = Array.from(STATE.sessions.values())
      .filter((s) => s.labId === labId)
      .map((s) => s.id);
  }
  const results: CaptureResult[] = [];
  for (const id of sessionIds) {
    const session = STATE.sessions.get(id);
    if (!session || session.labId !== labId) continue;
    results.push({
      captureId: session.id,
      linkId: session.linkId,
      dlt: session.dlt,
      captureUrl: session.stream.target,
      createdAt: session.createdAt,
    });
  }
  return results;
}

export function getCapture(labId: string, captureId: number): CaptureResult | null {
  const session = STATE.sessions.get(captureId);
  if (!session || session.labId !== labId) return null;
  return {
    captureId: session.id,
    linkId: session.linkId,
    dlt: session.dlt,
    captureUrl: session.stream.target,
    createdAt: session.createdAt,
  };
}

export function onNodeStop(labId: string, nodeId: string): void {
  const toStop = Array.from(STATE.sessions.values())
    .filter((session) => session.labId === labId && (session.link.a.nodeId === nodeId || session.link.b.nodeId === nodeId))
    .map((session) => session.id);

  for (const captureId of toStop) {
    stopCapture(labId, captureId);
  }
}

export function resetLabCaptures(labId: string): void {
  const toStop = Array.from(STATE.sessions.values())
    .filter((session) => session.labId === labId)
    .map((session) => session.id);
  for (const captureId of toStop) {
    stopCapture(labId, captureId);
  }
}

export function addPacketTap(captureId: number, tap: (payload: Buffer) => void): boolean {
  const session = STATE.sessions.get(captureId);
  if (!session) return false;
  session.packetTaps.add(tap);
  return true;
}

export function removePacketTap(captureId: number, tap: (payload: Buffer) => void): void {
  STATE.sessions.get(captureId)?.packetTaps.delete(tap);
}

export function rollbackStaleCaptureProxies(): { restored: number; skipped: number } {
  let restored = 0;
  let skipped = 0;
  if (!fs.existsSync(CONFIG.netioDir)) return { restored, skipped };

  const entries = fs.readdirSync(CONFIG.netioDir);
  for (const entry of entries) {
    if (!entry.endsWith("_real")) continue;
    const realPath = path.join(CONFIG.netioDir, entry);
    const socketPath = path.join(CONFIG.netioDir, entry.slice(0, -5));
    try {
      // 如果发现了以 _real 结尾的文件，说明它可能是之前某个代理的真实socket路径，
      // 因为上次崩溃导致代理未能正确清理。尝试将它恢复为原来的socket路径，以保证IOU通信正常。
      if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
      }
      fs.renameSync(realPath, socketPath);
      restored += 1;
    } catch {
      skipped += 1;
    }
  }

  return { restored, skipped };
}
