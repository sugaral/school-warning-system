const { uploadFile, loadAuthImageUrls, toastError } = require('./request');

function chooseLocalImages(remaining) {
  return new Promise((resolve, reject) => {
    if (typeof wx.chooseMedia === 'function') {
      wx.chooseMedia({
        count: remaining,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success(res) {
          const files = (res.tempFiles || []).map((f) => ({
            path: f.tempFilePath,
            size: f.size || 0,
          }));
          resolve(files);
        },
        fail(err) {
          reject(err);
        },
      });
      return;
    }

    wx.chooseImage({
      count: remaining,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success(res) {
        const files = (res.tempFiles || []).map((f, idx) => ({
          path: (res.tempFilePaths && res.tempFilePaths[idx]) || f.path,
          size: f.size || 0,
        }));
        resolve(files);
      },
      fail(err) {
        reject(err);
      },
    });
  });
}

/**
 * 选择并批量上传图片到 /files/images
 * @returns {Promise<Array<{ id: string, tempPath: string }>>}
 */
async function chooseAndUploadImages(options) {
  const opts = options || {};
  const maxCount = opts.maxCount || 6;
  const currentCount = opts.currentCount || 0;
  const source = opts.source || 'upload';
  const remaining = Math.max(0, maxCount - currentCount);

  if (remaining <= 0) {
    toastError('最多只能上传 ' + maxCount + ' 张图片');
    return [];
  }

  let picked = [];
  try {
    picked = await chooseLocalImages(remaining);
  } catch (err) {
    return [];
  }
  if (!picked.length) return [];

  const uploaded = [];
  wx.showLoading({ title: '正在上传图片', mask: true });
  try {
    for (let i = 0; i < picked.length; i += 1) {
      const file = picked[i];
      if (file.size && file.size > 5 * 1024 * 1024) {
        toastError('单张图片不能超过 5MB');
        continue;
      }
      const data = await uploadFile(file.path, {
        formData: { source },
      });
      if (data && data.id) {
        uploaded.push({
          id: String(data.id),
          tempPath: file.path,
        });
      }
    }
  } catch (err) {
    toastError((err && err.message) || '图片上传失败');
  } finally {
    wx.hideLoading();
  }
  return uploaded;
}

/** 根据 file_ids 加载临时图片路径并打开微信大图预览 */
async function previewByFileIds(fileIds, index) {
  const urls = await loadAuthImageUrls(fileIds);
  if (!urls.length) {
    toastError('暂无可预览图片');
    return;
  }
  const current = urls[index || 0] || urls[0];
  wx.previewImage({
    current,
    urls,
  });
}

module.exports = {
  chooseAndUploadImages,
  previewByFileIds,
};
