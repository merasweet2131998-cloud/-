
# Smart Basket Backend

## المتطلبات
- Node.js 18+
- Docker (للتشغيل السريع لقاعدة البيانات)
- Prisma CLI (تأتي ضمن devDependencies)

## التشغيل
```bash
cp .env.example .env
docker compose up -d        # يشغّل PostgreSQL محليًا
npm i
npm run prisma:generate
npm run prisma:migrate      # أنشئ الهياكل
npm run seed                # أدخل عينات بيانات
npm run dev                 # يشغّل السيرفر على http://localhost:$PORT (افتراضي 3000)
```

## أهم الEndpoints
- Auth: `POST /auth/request-otp` → `{ phone }`  | `POST /auth/verify-otp` → `{ phone, code }` (الرمز الافتراضي 123456)
- Profile: `GET/PUT /me/profile`
- Catalog: `GET /categories`, `GET /products?q=&category=`, `GET /products/:id`
- Recommendations: `GET /recommendations/home` (يتطلب Authorization: Bearer <token>)
- Cart: `GET /cart`, `POST /cart/items {productId, qty}`, `DELETE /cart/items/:id`
- Addresses: `POST /addresses`, `GET /addresses`
- Orders: `POST /orders {addressId}`, `GET /orders`, `GET /orders/:id`

> الطلبات مسموحة فقط لمدينة محددة في `.env` (افتراضي: Buraidah).

## اختبار سريع باستخدام curl
1) اطلب OTP (وستحصل على devOtp للاختبار):
```bash
curl -s http://localhost:3000/auth/request-otp -H "Content-Type: application/json" -d '{"phone":"+966500000000"}'
```
2) فعّل OTP واحصل على التوكن:
```bash
curl -s http://localhost:3000/auth/verify-otp -H "Content-Type: application/json" -d '{"phone":"+966500000000","code":"123456"}'
```
> انسخ `token` الناتج وضعه في كل طلبات لاحقة.

3) جلب التوصيات:
```bash
curl -s http://localhost:3000/recommendations/home -H "Authorization: Bearer TOKEN"
```

4) إضافة منتج للسلة (ضع معرف منتج من `/products`):
```bash
curl -s http://localhost:3000/cart/items -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"productId":"<ID>","qty":2}'
```

5) إضافة عنوان داخل بريدة:
```bash
curl -s http://localhost:3000/addresses -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"city":"Buraidah","district":"حي المنتزه"}'
```

6) إنشاء طلب:
```bash
curl -s http://localhost:3000/orders -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"addressId":"<ADDRESS_ID>"}'
```

## ملاحظات
- التوفير يُحتسب من الفرق بين `compareAtPrice` و `price` في عناصر السلة/الطلب.
- يمكن تغيير المدينة المسموحة عبر `ALLOWED_CITY` في `.env`.
