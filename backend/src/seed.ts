
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const categories = ['essentials', 'cleaners', 'produce', 'other'];
  const catMap: Record<string, string> = {};
  for (const name of categories) {
    const c = await prisma.category.upsert({
      where: { name },
      create: { name },
      update: {}
    });
    catMap[name] = c.id;
  }

  const sample = [
    ['أرز 5 كجم', 'essentials', 25, 32],
    ['زيت 1.5 لتر', 'essentials', 18, 22],
    ['سكر 5 كجم', 'essentials', 24, 30],
    ['مكرونة 500 جم', 'essentials', 5, 7],
    ['ملح 1 كجم', 'essentials', 3, 4],
    ['مناديل 10 رول', 'cleaners', 12, 16],
    ['مسحوق غسيل 3 كجم', 'cleaners', 30, 38],
    ['مناديل مطبخ 6 رول', 'cleaners', 11, 14],
    ['تمر سكري 1 كجم', 'produce', 20, 25],
    ['شاي 100 كيس', 'other', 10, 14],
  ] as const;

  for (const [name, cname, price, cap] of sample) {
    const p = await prisma.product.create({
      data: {
        name,
        categoryId: catMap[cname],
        price,
        compareAtPrice: cap,
        isActive: true
      }
    });
    await prisma.inventory.create({ data: { productId: p.id, qtyAvailable: 100 } });
  }
  console.log('Seed done.');
}

main().finally(() => prisma.$disconnect());
