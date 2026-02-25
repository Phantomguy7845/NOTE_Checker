# Apps Script Patch (`Code.gs`)

ใช้ patch นี้กับ `PHANToM Notes API Backend (Apps Script)` ที่คุณส่งมา

เป้าหมาย:
- ให้ `description` เป็น optional จริง (`createNote` / `updateNote`)
- รองรับ request แบบ `{ action, payload: {...} }` และ `{ action, ...fields }` พร้อมกัน
- รองรับ `setupNotesSheet` / `setupDailyCleanupTrigger` ผ่าน `GET` (ตามที่คุณใช้เรียกผ่าน URL)
- ล้างค่า zero-width จาก workaround เดิมของ frontend เวลาอ่าน/เขียน

## 1) แก้ `routeGetAction_()` ให้รองรับ setup ผ่าน GET

เพิ่มเคสเหล่านี้ใน `switch` (แถว admin/debug)

```javascript
    case 'setupNotesSheet':
      return setupNotesSheet();

    case 'setupDailyCleanupTrigger':
      return setupDailyCleanupTrigger();

    case 'removeCleanupTriggers':
      return removeCleanupTriggers();

    case 'cleanupExpiredImages':
      return cleanupExpiredImages();
```

## 2) แทนที่ `routePostAction_()` ทั้งฟังก์ชัน

```javascript
function routePostAction_(action, e, body) {
  const a = String(action || '').trim();
  const req = mergeBodyWithPayload_(body);

  switch (a) {
    case 'createNote': {
      // รองรับทั้ง body ตรง และ body.payload
      return createNote(req);
    }

    case 'updateNote': {
      // รองรับทั้ง body = { noteId, data } และ body.payload = { noteId, data }
      const noteId = String(req.noteId || '').trim();
      if (!noteId) throw new Error('Missing noteId');

      const data = req.data && typeof req.data === 'object' ? req.data : {
        title: req.title,
        description: req.description,
        imageDataUrl: req.imageDataUrl,
        imageBase64: req.imageBase64,
        imageMimeType: req.imageMimeType,
        imageName: req.imageName,
        removeImage: toBool_(req.removeImage)
      };

      return updateNote(noteId, data);
    }

    case 'markNoteDone': {
      const noteId = String(req.noteId || '').trim();
      if (!noteId) throw new Error('Missing noteId');
      return markNoteDone(noteId);
    }

    case 'getNoteImageData': {
      const fileId = String(req.fileId || '').trim();
      if (!fileId) throw new Error('Missing fileId');
      return getNoteImageData(fileId);
    }

    // admin setup
    case 'setupNotesSheet':
      return setupNotesSheet();

    case 'setupDailyCleanupTrigger':
      return setupDailyCleanupTrigger();

    case 'removeCleanupTriggers':
      return removeCleanupTriggers();

    case 'cleanupExpiredImages':
      return cleanupExpiredImages();

    default:
      throw new Error('Unknown POST action: ' + a);
  }
}
```

## 3) แทนที่ `createNote()` ทั้งฟังก์ชัน (description optional)

```javascript
function createNote(payload) {
  ensureSheetReady_();

  if (!payload || typeof payload !== 'object') {
    throw new Error('ข้อมูลไม่ถูกต้อง');
  }

  const title = String(payload.title || '').trim();
  const description = normalizeDescriptionInput_(payload.description);

  if (!title) throw new Error('กรุณากรอกหัวข้อ');
  // description optional

  const now = new Date();
  const noteId = Utilities.getUuid();

  let imageMeta = {
    imageFileId: '',
    imageUrl: '',
    imageMimeType: '',
    imageName: ''
  };

  const hasImageData = !!(payload.imageDataUrl || payload.imageBase64);
  if (hasImageData) {
    imageMeta = uploadImageInput_({
      imageDataUrl: payload.imageDataUrl || '',
      imageBase64: payload.imageBase64 || '',
      imageMimeType: payload.imageMimeType || '',
      imageName: payload.imageName || `note-${noteId}.jpg`,
      noteId: noteId
    });
  }

  const row = buildEmptyRow_();
  const h = getHeaderMap_();

  row[h.noteId] = noteId;
  row[h.title] = title;
  row[h.description] = description;
  row[h.imageFileId] = imageMeta.imageFileId || '';
  row[h.imageUrl] = imageMeta.imageUrl || '';
  row[h.imageMimeType] = imageMeta.imageMimeType || '';
  row[h.imageName] = imageMeta.imageName || '';
  row[h.status] = 'PENDING';
  row[h.createdAt] = now;
  row[h.createdDate] = formatDateOnly_(now);
  row[h.checkedAt] = '';
  row[h.updatedAt] = '';
  row[h.imageDeletedAt] = '';

  const sheet = getSheet_();
  sheet.appendRow(row);

  return {
    ok: true,
    item: sanitizeNoteForClient_(row, h, sheet.getLastRow())
  };
}
```

## 4) แทนที่ `updateNote()` ทั้งฟังก์ชัน (description optional)

```javascript
function updateNote(noteId, data) {
  ensureSheetReady_();

  if (!data || typeof data !== 'object') {
    throw new Error('ข้อมูลสำหรับแก้ไขไม่ถูกต้อง');
  }

  const found = findRowByNoteId_(noteId);
  if (!found) throw new Error('ไม่พบ NOTE');

  const { row, headerMap: h, rowIndex } = found;

  if (String(row[h.status] || '').toUpperCase() === 'DONE') {
    throw new Error('NOTE ที่อยู่ในประวัติไม่สามารถแก้ไขได้');
  }

  if (Object.prototype.hasOwnProperty.call(data, 'title')) {
    const title = String(data.title || '').trim();
    if (!title) throw new Error('หัวข้อห้ามว่าง');
    row[h.title] = title;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'description')) {
    // optional: ว่างได้
    row[h.description] = normalizeDescriptionInput_(data.description);
  }

  const hadImage = !!row[h.imageFileId];
  const removeImage = data.removeImage === true;
  const hasNewImage = !!(data.imageDataUrl || data.imageBase64);

  if (removeImage && hadImage) {
    safeTrashFile_(String(row[h.imageFileId]));
    row[h.imageFileId] = '';
    row[h.imageUrl] = '';
    row[h.imageMimeType] = '';
    row[h.imageName] = '';
    row[h.imageDeletedAt] = '';
  }

  if (hasNewImage) {
    if (hadImage && !removeImage) {
      safeTrashFile_(String(row[h.imageFileId]));
    }

    const uploaded = uploadImageInput_({
      imageDataUrl: data.imageDataUrl || '',
      imageBase64: data.imageBase64 || '',
      imageMimeType: data.imageMimeType || '',
      imageName: data.imageName || `note-${noteId}.jpg`,
      noteId: noteId
    });

    row[h.imageFileId] = uploaded.imageFileId || '';
    row[h.imageUrl] = uploaded.imageUrl || '';
    row[h.imageMimeType] = uploaded.imageMimeType || '';
    row[h.imageName] = uploaded.imageName || '';
    row[h.imageDeletedAt] = '';
  }

  row[h.updatedAt] = new Date();

  writeRow_(rowIndex, row);

  return {
    ok: true,
    item: sanitizeNoteForClient_(row, h, rowIndex)
  };
}
```

## 5) แก้ `sanitizeNoteForClient_()` บรรทัด `description`

แทนที่บรรทัดนี้:

```javascript
    description: String(row[h.description] || ''),
```

เป็น:

```javascript
    description: decodeLegacyEmptyDescriptionForClient_(row[h.description]),
```

## 6) เพิ่ม helper ใหม่ (วางในส่วน INTERNAL HELPERS ได้)

```javascript
function mergeBodyWithPayload_(body) {
  const src = (body && typeof body === 'object') ? body : {};
  const nested = (src.payload && typeof src.payload === 'object' && !Array.isArray(src.payload))
    ? src.payload
    : {};

  const merged = Object.assign({}, nested, src);
  delete merged.payload;
  return merged;
}

function normalizeDescriptionInput_(value) {
  // รองรับ frontend workaround เดิมที่ส่ง zero-width char แทนค่าว่าง
  const s = String(value || '').replace(/\u200B/g, '');
  return s.trim();
}

function decodeLegacyEmptyDescriptionForClient_(value) {
  const raw = String(value || '');
  if (!raw) return '';

  const noZw = raw.replace(/\u200B/g, '');
  if (!noZw.trim()) return '';
  return noZw;
}
```

## 7) หลังแก้เสร็จต้องทำอะไรต่อ

1. วางโค้ดลง `Code.gs` ใน Apps Script
2. Deploy web app version ใหม่ (หรือ redeploy deployment เดิม)
3. ทดสอบ
   - `GET .../exec?action=setupNotesSheet`
   - `GET .../exec?action=setupDailyCleanupTrigger`
   - สร้าง NOTE แบบไม่กรอก `description`
   - แก้ NOTE ให้ `description` ว่าง

## หมายเหตุฝั่ง Frontend

Frontend ใน repo นี้ถูก patch ไว้แล้วให้รองรับ backend หลายรูปแบบ (`payload` + top-level fields) จึงใช้งานร่วมกับ backend เวอร์ชันที่แก้แล้วได้ทันที
