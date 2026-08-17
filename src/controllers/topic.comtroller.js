const response = require("@/utils/response");
const topicService = require("@/service/topic.service");

const index = async (req, res) => {
  try {
    const topics = await topicService.getAll();
    response.succsess(res, 200, topics);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};
const getOne = async (req, res) => {
  try {
    const topic = await topicService.getById(req.params.id);
    response.succsess(res, 200, topic);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};
const getBySlug = async (req, res) => {
  try {
    const topic = await topicService.getBySlug(req.params.slug);

    response.succsess(res, 200, topic);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

const create = async (req, res) => {
  try {
    const topic = await topicService.create(req.body);
    response.succsess(res, 201, topic);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

const update = async (req, res) => {
  const topic = await topicService.update(req.params.id, req.body);

  res.json(topic);
};

const remove = async (req, res) => {
  await topicService.remove(req.params.id);
  res.status(204).send();
};

module.exports = {
  index,
  getOne,
  update,
  create,
  remove,
  getBySlug,
};
