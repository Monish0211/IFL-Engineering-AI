/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Loaded with Node's own require at runtime instead of being bundled by
    // webpack: onnxruntime-node ships a native binary, and pdf.js / mammoth
    // are large server-only libraries. Used only by the /api routes.
    serverComponentsExternalPackages: ['@huggingface/transformers', 'onnxruntime-node', 'unpdf', 'mammoth', '@google/genai'],
  },
};

export default nextConfig;
