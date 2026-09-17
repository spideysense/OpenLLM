import { build } from 'esbuild';
await build({entryPoints:['scripts/home-qr.jsx'],bundle:true,platform:'browser',format:'esm',minify:true,define:{'process.env.NODE_ENV':'"production"'},outfile:'site/home/qr.js'});
