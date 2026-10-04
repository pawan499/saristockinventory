# Sari inventory backend

Node.js 22.12+, Express, MongoDB/Mongoose. JWT login, user creation, sari inventory with private image uploads, JSON/CSV bulk import, and bill-photo OCR with review and confirmation.

## Run locally

```bash
npm install
cp .env.example .env
```

Set a random `JWT_SECRET` in `.env` (at least 32 characters; generate with `openssl rand -hex 32`). Set `MONGODB_URI` to MongoDB Atlas or a replica-set MongoDB connection. Bill confirmation uses transactions: standalone MongoDB does not support this operation.

For a local database with Docker:

```bash
docker compose up -d --wait
```

Create the first admin. Enter the password interactively so it is not stored in shell history:

```bash
export ADMIN_NAME='Owner'
export ADMIN_EMAIL='owner@example.com'
read -rs -p 'Admin password: ' ADMIN_PASSWORD
export ADMIN_PASSWORD
npm run create-admin
unset ADMIN_PASSWORD
npm run dev
```

Production command: `npm start`. API base URL: `http://localhost:4000/api`. There is no public registration endpoint. Every logged-in user can create normal users; only the bootstrap command creates an admin. Inventory and bills belong to their creator; other users cannot read or edit them. This is a per-user inventory, not a shared shop inventory.

## API

All endpoints except login and `/health` require `Authorization: Bearer <token>`.

| Method | Endpoint | Body / purpose |
| --- | --- | --- |
| POST | `/api/auth/login` | JSON `{ "email": "owner@example.com", "password": "..." }`; returns token and user |
| GET | `/api/auth/me` | Current user |
| POST | `/api/users` | JSON `{ "name": "Staff", "email": "staff@example.com", "password": "password123" }` |
| GET | `/api/users` | Admin-only user list, max 500 |
| POST | `/api/saris` | JSON or multipart: `companyName`, `sariName`, `price`, `quantity`; optional image file field `image` |
| GET | `/api/saris` | `?page=1&limit=20&search=silk` |
| GET | `/api/saris/:id` | View own sari |
| PATCH | `/api/saris/:id` | JSON/multipart changed fields and optional replacement `image` |
| POST | `/api/saris/bulk` | JSON `{ "items": [...] }`, or multipart CSV file field `file` |
| GET | `/api/images/:filename` | Authenticated image response; filename is the stored `image` value |
| POST | `/api/bills/extract` | Multipart bill photo `image`, optional `companyName`; returns bill ID, OCR text, confidence, suggested items |
| GET | `/api/bills/:id` | Retrieve own bill and its import status |
| POST | `/api/bills/:id/confirm` | JSON `{ "items": [...] }` with reviewed/corrected items; atomically imports once |
| GET | `/health` | 200 when DB connected; otherwise 503 |

Example login:

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","password":"your-password"}'
```

Use returned token:

```bash
export TOKEN='paste-token'
curl -X POST http://localhost:4000/api/saris \
  -H "Authorization: Bearer $TOKEN" \
  -F 'companyName=ABC Textiles' -F 'sariName=Banarasi Silk' \
  -F 'price=1500.50' -F 'quantity=10' -F 'image=@/path/to/sari.jpg'

curl -X POST http://localhost:4000/api/saris/bulk \
  -H "Authorization: Bearer $TOKEN" -F 'file=@examples/saris.csv'

curl -X POST http://localhost:4000/api/bills/extract \
  -H "Authorization: Bearer $TOKEN" \
  -F 'companyName=ABC Textiles' -F 'image=@/path/to/bill.jpg'
```

Review OCR output, correct company/name/quantity/unit price, then confirm:

```bash
curl -X POST http://localhost:4000/api/bills/BILL_ID/confirm \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"items":[{"companyName":"ABC Textiles","sariName":"Banarasi Silk","price":1500.50,"quantity":10}]}'
```

Prices are unit prices in INR with up to two decimals; quantities are whole, non-negative values. Bulk supports 1–500 records; all rows are validated before insertion. Every row creates a new inventory record, including repeats; this version does not merge existing stock. CSV columns must be exactly `companyName,sariName,price,quantity`; see `examples/saris.csv`. Bulk images can be added afterward with PATCH.

## Bill OCR and images

Tesseract OCR runs locally; no paid API key is required. On first use it downloads language data, requiring outbound internet. Default language is English; set `OCR_LANGUAGES=eng+hin` for Hindi and English. Input images must be actual JPEG/PNG/WebP, up to 8 MB and 25 megapixels. Images are re-encoded, metadata removed, and stored under `UPLOAD_DIR`. Keep that directory persistent and back it up with MongoDB.

OCR text is available for every readable bill. Suggested rows use a conservative parser for `name | quantity | unit price [| amount]` or clearly spaced table rows. Arbitrary layouts/handwriting can produce empty or incorrect suggestions. Company name comes from your supplied field; enter it during review if omitted. Photo extraction alone never changes stock. Confirmation validates all corrected rows and prevents duplicate imports of the same bill ID. Separate uploads of the same photo are separate bills.

Images are protected by bearer authentication. A frontend should fetch the image as an authenticated blob and use an object URL. Error responses use `{ "message": "...", "errors": [...] }` for validation failures. Tokens expire after 12 hours; login again after expiry.

## Verification

```bash
npm test
npm run test:ocr
```

Tests require a `mongod` executable on PATH and available localhost port 27931. They start an isolated temporary replica set and remove it afterward. Tests cover authentication, user creation, ownership, image validation, bulk validation, editing, and concurrent duplicate bill confirmation. API tests inject OCR text. `npm run test:ocr` separately runs the real engine on a generated sample bill and may download language data. Check recognition with your real bill formats before relying on suggestions.

Dependencies follow the official [Express API](https://expressjs.com/en/5x/api/), [Mongoose documentation](https://mongoosejs.com/docs/), and [Tesseract.js documentation](https://github.com/naptha/tesseract.js#readme).
