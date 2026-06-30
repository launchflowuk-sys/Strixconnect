declare module "pdf-parse" {
  interface PDFData {
    text: string;
    numpages: number;
    info: Record<string, any>;
    metadata: Record<string, any>;
  }
  function pdfParse(buffer: Buffer, options?: Record<string, any>): Promise<PDFData>;
  export = pdfParse;
}
