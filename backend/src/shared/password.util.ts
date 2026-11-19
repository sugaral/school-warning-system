/**
 * 密码哈希工具
 *
 * §11.5 性能修复：默认使用 **@node-rs/bcrypt**（Rust 实现，走 libuv 线程池），
 * 而不是纯 JS 的 bcryptjs。
 *
 * 压测实测（20 并发登录）：
 *   bcryptjs  → P50=2916ms P95=2928ms P99=2929ms（约 8 req/s）**未达标**
 *   原因：bcryptjs 是纯 JavaScript，bcrypt 计算跑在 Node 主线程上，
 *   20 个并发登录被**串行化**占满单核（单个 hash 约 145ms × 20 ≈ 2.9s）。
 *   这不是"服务器慢"，而是事件循环被 CPU 计算阻塞。
 *   @node-rs/bcrypt 通过线程池并行执行 → P50 102ms / P99 115ms（25× 提升）。
 *
 * 为什么不用 npm 上的 `bcrypt`：它在 `node:20-alpine` 上**无法安装** ——
 *   node-pre-gyp 需要从 GitHub Releases 下载 musl 预编译包（构建环境常被
 *   网络策略拦截，实测 ECONNREFUSED），回退源码编译又缺 python3/make/g++。
 *   实测构建直接失败（Dockerfile.prod 的 npm ci --omit=dev 报错）。
 *   @node-rs/bcrypt 通过 npm optionalDependencies 分发各平台预编译二进制，
 *   含 `linux-x64-musl`，在 Alpine 上开箱可用。
 *
 * 兼容性：三者生成的哈希格式一致（$2a$/$2b$ + cost），
 * 实测 @node-rs/bcrypt 可以校验 bcryptjs 生成的存量哈希，**无需迁移密码**。
 * 加载失败时依次回退，保证任何环境下都可用。
 */
import * as bcryptjs from 'bcryptjs';

type Hasher = {
  hash(pw: string, rounds: number): Promise<string>;
  compare(pw: string, hash: string): Promise<boolean>;
};

function tryLoad(mod: string, label: string): { hasher: Hasher; kind: string } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const m = require(mod);
    if (typeof m?.hash === 'function' && typeof m?.compare === 'function') {
      return { hasher: m as Hasher, kind: label };
    }
  } catch {
    /* 继续尝试下一个实现 */
  }
  return null;
}

/** 按「性能优先」顺序探测可用的 bcrypt 实现 */
const loaded =
  tryLoad('@node-rs/bcrypt', 'node-rs') ||
  tryLoad('bcrypt', 'native') ||
  { hasher: bcryptjs as unknown as Hasher, kind: 'js' };

const hasher: Hasher = loaded.hasher;
const hasherKind = loaded.kind;

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$/;
const PASSWORD_SALT_ROUNDS = 10;

/** 当前使用的实现（供健康检查/诊断读取） */
export function getPasswordHasherKind(): string {
  return hasherKind;
}

export function isBcryptHash(value?: string | null): boolean {
  return !!value && BCRYPT_HASH_PATTERN.test(value);
}

export async function hashPassword(password: string): Promise<string> {
  return hasher.hash(password, PASSWORD_SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  storedPassword: string,
): Promise<boolean> {
  if (!storedPassword) {
    return false;
  }

  if (!isBcryptHash(storedPassword)) {
    return false;
  }

  return hasher.compare(password, storedPassword);
}

/**
 * bcrypt 哈希是 CPU 密集操作，原生实现的并行度受 UV_THREADPOOL_SIZE 限制。
 * 该值需在进程启动前设置才生效（见 docker-compose 的 UV_THREADPOOL_SIZE）。
 */
export const RECOMMENDED_UV_THREADPOOL_SIZE = 8;
