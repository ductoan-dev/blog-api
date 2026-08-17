const response = require("@/utils/response");
const postService = require("@/service/post.service");

const index = async (req, res) => {
  const { posts } = await postService.getAll(req.user);
  response.succsess(res, 200, posts);
};
const getBySlug = async (req, res) => {
  try {
    const post = await postService.getBySlug(req.params.slug, req.user);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found",
      });
    }

    res.json({
      success: true,
      post,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
const getListByMe = async (req, res) => {
  try {
    const posts = await postService.getListByMe(req.user);
    response.succsess(res, 200, posts);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

const getListByUserId = async (req, res) => {
  try {
    const posts = await postService.getBookmarkedPostsByUser(req.user);

    response.succsess(res, 200, posts);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};
const getByTopicId = async (req, res) => {
  try {
    const posts = await postService.getByTopicId(req.user, req.params.topicId);
    response.succsess(res, 200, posts);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};
const getRelatedPosts = async (req, res) => {
  try {
    const posts = await postService.getRelatedPosts(
      req.params.postId,
      req.user
    );
    response.succsess(res, 200, posts);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};
const getByUserName = async (req, res) => {
  try {
    const posts = await postService.getByUserName(
      req.params.username,
      req.user
    );

    response.succsess(res, 200, posts);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};
const search = async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return response.succsess(res, 200, []);
    const posts = await postService.search(q, req.user);
    response.succsess(res, 200, posts);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

const getFollowingFeed = async (req, res) => {
  try {
    const posts = await postService.getFollowingFeed(req.user);
    response.succsess(res, 200, posts);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

const viewsCount = async (req, res) => {
  try {
    const post = await postService.viewsCount(req.params.id);
    response.succsess(res, 200, post);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};
const toggleLike = async (req, res) => {
  try {
    const post = await postService.toggleLike(req.user, req.params.postId);
    response.succsess(res, 200, post);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};
const update = async (req, res) => {
  const post = await postService.update(req.params.id, req.body);

  res.json(post);
};
const create = async (req, res) => {
  try {
    const post = await postService.create(req.file, req.body, req.user);
    response.succsess(res, 200, post);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};
const remove = async (req, res) => {
  await postService.remove(req.params.id);
  res.status(204).send();
};

module.exports = {
  index,
  search,
  getBySlug,
  getListByMe,
  getRelatedPosts,
  getByTopicId,
  getListByUserId,
  getByUserName,
  getFollowingFeed,
  viewsCount,
  toggleLike,
  update,
  create,
  remove,
};
