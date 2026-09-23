import "server-only";

import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PREVIEW_TIMEOUT_MS = 120_000;
const POWERPOINT_PDF_FORMAT = 32;

export type PptxPreviewMetadata = {
  type: "pdf";
  storagePath: string;
  mimeType: "application/pdf";
  generatedAt: string;
  converter: "libreoffice" | "powerpoint-com";
};

type StorageClient = {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        body: Buffer,
        options: { contentType: string; upsert: boolean },
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
};

function safeBaseName(fileName: string) {
  const cleaned = fileName.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "slides.pptx";
}

async function commandExists(command: string) {
  const checker = process.platform === "win32" ? "where.exe" : "which";
  try {
    await execFileAsync(checker, [command], { timeout: 5_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function hasPowerPointCom() {
  if (process.platform !== "win32") return false;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "$ErrorActionPreference='Stop'; $app = New-Object -ComObject PowerPoint.Application; if ($app) { $app.Quit(); 'ok' }",
      ],
      { timeout: 15_000, windowsHide: true },
    );
    return stdout.includes("ok");
  } catch {
    return false;
  }
}

async function convertWithLibreOffice(inputPath: string, outputDir: string) {
  const command = (await commandExists("soffice")) ? "soffice" : (await commandExists("libreoffice")) ? "libreoffice" : null;
  if (!command) return null;

  await execFileAsync(command, ["--headless", "--convert-to", "pdf", "--outdir", outputDir, inputPath], {
    timeout: PREVIEW_TIMEOUT_MS,
    windowsHide: true,
  });

  return {
    converter: "libreoffice" as const,
    pdfPath: path.join(outputDir, `${path.basename(inputPath, path.extname(inputPath))}.pdf`),
  };
}

async function convertWithPowerPoint(inputPath: string, outputPath: string, tempDir: string) {
  if (!(await hasPowerPointCom())) return null;

  const scriptPath = path.join(tempDir, "convert-pptx-preview.ps1");
  await writeFile(
    scriptPath,
    `
$ErrorActionPreference = "Stop"
$pptxPath = ${JSON.stringify(inputPath)}
$pdfPath = ${JSON.stringify(outputPath)}
$app = $null
$presentation = $null
try {
  $app = New-Object -ComObject PowerPoint.Application
  $presentation = $app.Presentations.Open($pptxPath, $true, $false, $false)
  $presentation.SaveAs($pdfPath, ${POWERPOINT_PDF_FORMAT})
}
finally {
  if ($presentation -ne $null) {
    $presentation.Close()
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($presentation)
  }
  if ($app -ne $null) {
    $app.Quit()
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
`,
    "utf8",
  );

  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath], {
    timeout: PREVIEW_TIMEOUT_MS,
    windowsHide: true,
  });

  return { converter: "powerpoint-com" as const, pdfPath: outputPath };
}

export async function createPptxPreviewPdf(buffer: Buffer, fileName: string) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "studypilot-pptx-preview-"));
  try {
    const inputPath = path.join(tempDir, `${crypto.randomUUID()}-${safeBaseName(fileName)}`);
    const outputPath = path.join(tempDir, `${path.basename(inputPath, path.extname(inputPath))}.pdf`);
    await writeFile(inputPath, buffer);

    const converted = (await convertWithLibreOffice(inputPath, tempDir)) ?? (await convertWithPowerPoint(inputPath, outputPath, tempDir));
    if (!converted) {
      throw new Error("No local PPTX preview converter is available. Install LibreOffice or enable local PowerPoint conversion.");
    }

    let pdf: Buffer;
    try {
      pdf = await readFile(/* turbopackIgnore: true */ converted.pdfPath);
    } catch {
      throw new Error("PPTX preview conversion did not produce a PDF.");
    }
    if (!pdf.length || !pdf.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
      throw new Error("PPTX preview conversion did not produce a valid PDF.");
    }

    return { pdf, converter: converted.converter };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function generateAndStorePptxPreview({
  supabase,
  userId,
  fileId,
  fileName,
  pptxBuffer,
}: {
  supabase: StorageClient;
  userId: string;
  fileId: string;
  fileName: string;
  pptxBuffer: Buffer;
}): Promise<PptxPreviewMetadata> {
  const { pdf, converter } = await createPptxPreviewPdf(pptxBuffer, fileName);
  const storagePath = `${userId}/previews/${fileId}.pdf`;
  const upload = await supabase.storage.from("study-files").upload(storagePath, pdf, {
    contentType: "application/pdf",
    upsert: true,
  });

  if (upload.error) throw new Error("Could not store the PPTX visual preview.");

  return {
    type: "pdf",
    storagePath,
    mimeType: "application/pdf",
    generatedAt: new Date().toISOString(),
    converter,
  };
}
