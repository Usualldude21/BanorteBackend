import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { z } from "zod";
import { type PasswordCredentials } from "../../config/supabase.js";

const InteractiveCredentialsSchema = z.object({
  email: z.string().trim().email("El correo no tiene un formato válido").max(320),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres").max(1_024),
}).strict();

export async function requestCredentials(): Promise<PasswordCredentials> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new InteractiveLoginError("El login interactivo requiere una terminal TTY");
  }

  const output = new MutedOutput();
  const terminal = createInterface({ input: stdin, output, terminal: true });

  try {
    const email = await terminal.question("Email: ");
    stdout.write("Contraseña: ");
    output.mute();
    const password = await terminal.question("");
    output.unmute();
    stdout.write("\n");
    return InteractiveCredentialsSchema.parse({ email, password });
  } finally {
    output.unmute();
    terminal.close();
  }
}

class MutedOutput extends Writable {
  private isMuted = false;

  mute(): void {
    this.isMuted = true;
  }

  unmute(): void {
    this.isMuted = false;
  }

  override _write(
    chunk: Uint8Array,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (!this.isMuted) stdout.write(chunk);
    callback();
  }
}

export class InteractiveLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InteractiveLoginError";
  }
}
