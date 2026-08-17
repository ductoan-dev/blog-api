const bookmarksService = require("@/service/bookmarks.service");
const response = require("@/utils/response");
exports.create = async (req, res) => {
  try {
    const bookmark = await bookmarksService.toggleBookmark(
      req.user,
      req.params.postId
    );

    response.succsess(res, 200, bookmark);
  } catch (error) {
    console.log(error);

    response.error(res, 400, error.message);
  }
};

exports.remove = async (req, res) => {
  try {
    await bookmarksService.remove(req.user, req.body);
    response.succsess(res, 204, "");
  } catch (error) {
    console.log(error);

    response.error(res, 400, error.message);
  }
};
