const { Topic } = require("@/db/models");
const slugify = require("slugify");
const { faker } = require("@faker-js/faker");

class TopicService {
  async getAll() {
    try {
      return await Topic.find();
    } catch (error) {
      throw new Error("Unable to fetch the list of topics");
    }
  }

  async getById(id) {
    return await Topic.findById(id);
  }

  async getBySlug(slug) {
    try {
      return await Topic.findOne({ slug });
    } catch (error) {
      throw new Error("Invalid slug");
    }
  }

  async findOrCreate(name) {
    const existing = await Topic.findOne({ name });
    if (existing) {
      return { topic: existing, created: false };
    }

    const baseSlug = slugify(name, { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;
    while (await Topic.findOne({ slug })) {
      slug = `${baseSlug}-${counter++}`;
    }

    const topic = await Topic.create({
      name,
      slug,
      image: faker.image.urlPicsumPhotos(),
      description: faker.lorem.sentence(),
      posts_count: 0,
    });

    return { topic, created: true };
  }

  async create(data) {
    const { name, description, image } = data;
    if (!name?.trim()) throw new Error("Topic name is required");

    const baseSlug = slugify(name.trim(), { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;
    while (await Topic.findOne({ slug })) {
      slug = `${baseSlug}-${counter++}`;
    }

    return await Topic.create({
      name: name.trim(),
      slug,
      description: description?.trim() || "",
      image: image?.trim() || faker.image.urlPicsumPhotos(),
      posts_count: 0,
    });
  }

  async update(id, data) {
    try {
      return await Topic.findByIdAndUpdate(id, data, { new: true });
    } catch (error) {
      console.log("Lỗi khi update: ", error);
      return null;
    }
  }

  async remove(id) {
    await Topic.findByIdAndDelete(id);
    return null;
  }
}

module.exports = new TopicService();
