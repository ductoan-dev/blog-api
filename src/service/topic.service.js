const prisma = require("@/db/prisma");
const slugify = require("slugify");
const { faker } = require("@faker-js/faker");

class TopicService {
  async getAll() {
    try {
      return await prisma.topic.findMany();
    } catch (error) {
      throw new Error("Unable to fetch the list of topics");
    }
  }

  async getById(id) {
    return prisma.topic.findUnique({ where: { id } });
  }

  async getBySlug(slug) {
    try {
      return await prisma.topic.findUnique({ where: { slug } });
    } catch (error) {
      throw new Error("Invalid slug");
    }
  }

  async findOrCreate(name) {
    const existing = await prisma.topic.findFirst({ where: { name } });
    if (existing) {
      return { topic: existing, created: false };
    }

    const baseSlug = slugify(name, { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;
    while (await prisma.topic.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter++}`;
    }

    const topic = await prisma.topic.create({
      data: {
        name,
        slug,
        image: faker.image.urlPicsumPhotos(),
        description: faker.lorem.sentence(),
        postsCount: 0,
      },
    });

    return { topic, created: true };
  }

  async create(data) {
    const { name, description, image } = data;
    if (!name?.trim()) throw new Error("Topic name is required");

    const baseSlug = slugify(name.trim(), { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;
    while (await prisma.topic.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter++}`;
    }

    return prisma.topic.create({
      data: {
        name: name.trim(),
        slug,
        description: description?.trim() || "",
        image: image?.trim() || faker.image.urlPicsumPhotos(),
        postsCount: 0,
      },
    });
  }

  async update(id, data) {
    try {
      return await prisma.topic.update({ where: { id }, data });
    } catch (error) {
      console.log("Lỗi khi update: ", error);
      return null;
    }
  }

  async remove(id) {
    await prisma.topic.delete({ where: { id } });
    return null;
  }
}

module.exports = new TopicService();
