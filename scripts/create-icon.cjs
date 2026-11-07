const fs = require('node:fs/promises');
const path = require('node:path');
async function main(){
  const sharp = require(process.env.DV_SHARP_PATH || 'sharp');
  const root=path.join(__dirname,'..','assets');
  await fs.mkdir(root,{recursive:true});
  const svg=`<svg width="256" height="256" xmlns="http://www.w3.org/2000/svg"><rect width="256" height="256" rx="54" fill="#202723"/><path d="M44 62h53c44 0 66 23 66 64s-22 68-66 68H44V62zm32 29v74h20c26 0 37-14 37-39s-11-35-37-35H76z" fill="#e1ece4"/><path d="m133 62 33 90 32-90h35l-51 132h-32L99 62h34z" fill="#9edbc5"/></svg>`;
  const png=await sharp(Buffer.from(svg)).png().toBuffer();
  const header=Buffer.alloc(22);
  header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);
  header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);
  header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
  await fs.writeFile(path.join(root,'icon.png'),png);
  await fs.writeFile(path.join(root,'icon.ico'),Buffer.concat([header,png]));
  await fs.writeFile(path.join(root,'icon.svg'),svg);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
