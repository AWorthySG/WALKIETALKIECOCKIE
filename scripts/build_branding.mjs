import sharp from 'sharp';
import {mkdir,writeFile} from 'node:fs/promises';
const source='branding/sticker-original.png';
const background='#000000';
await mkdir('mobile/assets/brand',{recursive:true});
await sharp(source).resize(768,768,{fit:'inside'}).webp({quality:88}).toFile('web/sticker.webp');
await sharp(source).resize(768,768,{fit:'inside'}).png({palette:true,quality:90,colors:256}).toFile('mobile/assets/brand/sticker.png');
async function icon(size,path,ratio=.88) {
 const side=Math.round(size*ratio);
 const sticker=await sharp(source).resize(side,side,{fit:'inside'}).png().toBuffer();
 await sharp({create:{width:size,height:size,channels:4,background}}).composite([{input:sticker,gravity:'centre'}]).removeAlpha().png({palette:true,quality:90,colors:256}).toFile(path);
}
for(const size of [192,512])await icon(size,`web/icon-${size}.png`);
await icon(180,'web/apple-touch-icon.png');
// A centred square within the mandatory Android maskable safe circle.
await icon(512,'web/icon-maskable.png',.56);
const webp=await sharp(source).resize(128,128).webp({quality:85}).toBuffer();
await writeFile('web/icon.svg',`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="22" fill="${background}"/><image x="8" y="8" width="112" height="112" href="data:image/webp;base64,${webp.toString('base64')}"/></svg>`);
await mkdir('mobile/assets/app-icons/android',{recursive:true});
for(const [density,size] of Object.entries({mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192})) {
 const folder=`mobile/assets/app-icons/android/mipmap-${density}`;
 await mkdir(folder,{recursive:true});await icon(size,`${folder}/ic_launcher.png`,.70);
}
const ios='mobile/assets/app-icons/ios';await mkdir(ios,{recursive:true});
const images=[];
for(const idiom of ['iphone','ipad','ios-marketing']) {
 const sizes=idiom==='iphone'?[[20,2],[20,3],[29,2],[29,3],[40,2],[40,3],[60,2],[60,3]]:idiom==='ipad'?[[20,1],[20,2],[29,1],[29,2],[40,1],[40,2],[76,1],[76,2],[83.5,2]]:[[1024,1]];
 for(const [size,scale] of sizes) {
  const filename=`icon-${idiom}-${size}@${scale}x.png`;
  await icon(Math.round(size*scale),`${ios}/${filename}`);
  images.push({idiom,size:`${size}x${size}`,scale:`${scale}x`,filename});
 }
}
await writeFile(`${ios}/Contents.json`,JSON.stringify({images,info:{version:1,author:'xcode'}},null,2));
console.log('Built sticker logo, cover, web icons and native launcher artwork.');
