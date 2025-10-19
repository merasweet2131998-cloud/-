
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const OTP_CODE = process.env.OTP_CODE || '123456';
const ALLOWED_CITY = process.env.ALLOWED_CITY || 'Buraidah';

type JwtUser = { userId: string };

function signToken(userId: string) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

function auth(req: any, res: any, next: any) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtUser;
    (req as any).userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.get('/health', (_, res) => res.json({ ok: true }));

// --- Auth (OTP mock) ---
app.post('/auth/request-otp', async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone required' });
  // In production: send OTP via SMS provider.
  return res.json({ ok: true, devOtp: OTP_CODE });
});

app.post('/auth/verify-otp', async (req, res) => {
  const { phone, code } = req.body || {};
  if (!phone || !code) return res.status(400).json({ error: 'phone & code required' });
  if (code !== OTP_CODE) return res.status(400).json({ error: 'invalid code' });

  let user = await prisma.user.findUnique({ where: { phone } });
  if (!user) {
    user = await prisma.user.create({ data: { phone, city: ALLOWED_CITY } });
    await prisma.userProfile.create({ data: { userId: user.id, familySize: 2, monthlyBudget: 600 } });
  }
  const token = signToken(user.id);
  return res.json({ token, user });
});

// --- Profile ---
app.get('/me/profile', auth, async (req, res) => {
  const userId = (req as any).userId as string;
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  return res.json(profile);
});

app.put('/me/profile', auth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { familySize, monthlyBudget, city } = req.body || {};
  if (city && city !== ALLOWED_CITY) {
    return res.status(400).json({ error: `Service limited to ${ALLOWED_CITY} for MVP` });
  }
  const user = await prisma.user.update({
    where: { id: userId },
    data: { city: city ?? undefined }
  });
  const profile = await prisma.userProfile.update({
    where: { userId },
    data: {
      familySize: typeof familySize === 'number' ? familySize : undefined,
      monthlyBudget: typeof monthlyBudget === 'number' ? monthlyBudget : undefined
    }
  });
  return res.json({ user, profile });
});

// --- Catalog ---
app.get('/categories', async (_, res) => {
  const cats = await prisma.category.findMany({ orderBy: { name: 'asc' } });
  res.json({ items: cats });
});

app.get('/products', async (req, res) => {
  const q = (req.query.q as string)?.toLowerCase() || '';
  const category = (req.query.category as string) || '';
  const where : any = { isActive: true };
  if (q) where.name = { contains: q, mode: 'insensitive' };
  if (category) where.category = { is: { name: category } };
  const items = await prisma.product.findMany({
    where,
    include: { category: true, inventory: true },
    orderBy: [{ name: 'asc' }]
  });
  res.json({ items });
});

app.get('/products/:id', async (req, res) => {
  const p = await prisma.product.findUnique({
    where: { id: req.params.id },
    include: { category: true, inventory: true }
  });
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(p);
});

// --- Recommendations ---
function valueOf(p: any) {
  const cap = p.compareAtPrice ? Number(p.compareAtPrice) : Number(p.price);
  return cap - Number(p.price);
}

app.get('/recommendations/home', auth, async (req, res) => {
  const userId = (req as any).userId as string;
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  const monthlyBudget = profile?.monthlyBudget ?? 600;
  const familySize = profile?.familySize ?? 2;

  const weights = { essentials: 0.5, cleaners: 0.2, produce: 0.15, other: 0.15 };
  const items = await prisma.product.findMany({
    where: { isActive: true },
    include: { category: true }
  });
  // Sort by value desc then price asc
  items.sort((a: any, b: any) => valueOf(b) - valueOf(a) || Number(a.price) - Number(b.price));

  const byCat: Record<string, any[]> = { essentials: [], cleaners: [], produce: [], other: [] };
  for (const p of items) {
    const name = p.category.name.toLowerCase();
    if (byCat[name]) byCat[name].push(p);
    else (byCat.other ??= []).push(p);
  }

  const target = {
    essentials: monthlyBudget * weights.essentials / 30,
    cleaners: monthlyBudget * weights.cleaners / 30,
    produce: monthlyBudget * weights.produce / 30,
    other: monthlyBudget * weights.other / 30
  };

  const recommended: any[] = [];
  let estimatedSavings = 0;

  for (const k of Object.keys(byCat)) {
    let sum = 0;
    for (const p of byCat[k]) {
      const price = Number(p.price);
      if (sum + price <= target[k] + 10) {
        recommended.push(p);
        sum += price;
        estimatedSavings += Math.max(0, (Number(p.compareAtPrice ?? p.price) - price));
      }
      if (sum >= target[k]) break;
    }
  }
  const recIds = new Set(recommended.map(p => p.id));
  const alternatives = items.filter(p => !recIds.has(p.id)).slice(0, 60);

  res.json({ recommended, alternatives, estimatedSavings });
});

// --- Cart ---
async function getOrCreateCart(userId: string) {
  let cart = await prisma.cart.findFirst({ where: { userId }, include: { items: { include: { product: true } } } });
  if (!cart) cart = await prisma.cart.create({ data: { userId } });
  return cart;
}

async function recalcCart(cartId: string) {
  const cart = await prisma.cart.findUnique({ where: { id: cartId }, include: { items: { include: { product: true } } } });
  if (!cart) return;
  let total = 0, savings = 0;
  for (const it of cart.items) {
    total += Number(it.unitPrice) * it.qty;
    const cap = Number(it.product.compareAtPrice ?? it.unitPrice);
    savings += Math.max(0, (cap - Number(it.unitPrice)) * it.qty);
  }
  await prisma.cart.update({ where: { id: cartId }, data: { total, savings } });
}

app.get('/cart', auth, async (req, res) => {
  const userId = (req as any).userId as string;
  const cart = await getOrCreateCart(userId);
  const full = await prisma.cart.findUnique({ where: { id: cart.id }, include: { items: { include: { product: true } } } });
  res.json(full);
});

app.post('/cart/items', auth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { productId, qty } = req.body || {};
  if (!productId) return res.status(400).json({ error: 'productId required' });
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return res.status(404).json({ error: 'product not found' });

  const cart = await getOrCreateCart(userId);
  const existing = await prisma.cartItem.findFirst({ where: { cartId: cart.id, productId } });
  const newQty = Math.max(1, Number(qty ?? 1));
  if (existing) {
    await prisma.cartItem.update({ where: { id: existing.id }, data: { qty: newQty, unitPrice: product.price } });
  } else {
    await prisma.cartItem.create({ data: { cartId: cart.id, productId, qty: newQty, unitPrice: product.price } });
  }
  await recalcCart(cart.id);
  const full = await prisma.cart.findUnique({ where: { id: cart.id }, include: { items: { include: { product: true } } } });
  res.json(full);
});

app.delete('/cart/items/:id', auth, async (req, res) => {
  const userId = (req as any).userId as string;
  const cart = await getOrCreateCart(userId);
  await prisma.cartItem.delete({ where: { id: req.params.id } }).catch(() => {});
  await recalcCart(cart.id);
  const full = await prisma.cart.findUnique({ where: { id: cart.id }, include: { items: { include: { product: true } } } });
  res.json(full);
});

// --- Orders ---
app.post('/orders', auth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { addressId } = req.body || {};
  if (!addressId) return res.status(400).json({ error: 'addressId required' });

  const address = await prisma.address.findUnique({ where: { id: addressId } });
  if (!address) return res.status(404).json({ error: 'address not found' });
  if (address.city !== ALLOWED_CITY) return res.status(400).json({ error: `Service limited to ${ALLOWED_CITY}` });

  const cart = await getOrCreateCart(userId);
  const full = await prisma.cart.findUnique({ where: { id: cart.id }, include: { items: { include: { product: true } } } });
  if (!full || full.items.length === 0) return res.status(400).json({ error: 'cart is empty' });

  const order = await prisma.order.create({
    data: {
      userId,
      addressId,
      total: full.total,
      savings: full.savings,
      items: {
        create: full.items.map(it => ({
          productId: it.productId,
          qty: it.qty,
          unitPrice: it.unitPrice
        }))
      }
    },
    include: { items: true }
  });

  // Clear cart
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  await prisma.cart.update({ where: { id: cart.id }, data: { total: 0, savings: 0 } });

  res.json(order);
});

app.get('/orders', auth, async (req, res) => {
  const userId = (req as any).userId as string;
  const orders = await prisma.order.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  res.json({ items: orders });
});

app.get('/orders/:id', auth, async (req, res) => {
  const userId = (req as any).userId as string;
  const order = await prisma.order.findFirst({ where: { id: req.params.id, userId }, include: { items: { include: { product: true } }, address: true } });
  if (!order) return res.status(404).json({ error: 'not found' });
  res.json(order);
});

// --- Addresses ---
app.post('/addresses', auth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { city, district, street, notes } = req.body || {};
  if (!city) return res.status(400).json({ error: 'city required' });
  const a = await prisma.address.create({ data: { userId, city, district, street, notes } });
  res.json(a);
});

app.get('/addresses', auth, async (req, res) => {
  const userId = (req as any).userId as string;
  const items = await prisma.address.findMany({ where: { userId } });
  res.json({ items });
});

app.listen(PORT, () => console.log(`Smart Basket API on http://localhost:${PORT}`));
