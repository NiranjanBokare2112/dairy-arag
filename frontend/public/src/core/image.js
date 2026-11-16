// Shrink a picture before saving it (bill photos D-126, ticket screenshots D-138): longest side `max` px, JPEG, so phones,
// the database and backups stay small. Resolves a data URL; rejects for a file that is not a picture.
export function shrinkImage(file, max = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src);
      resolve(cv.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('invalid')); };
    img.src = URL.createObjectURL(file);
  });
}
