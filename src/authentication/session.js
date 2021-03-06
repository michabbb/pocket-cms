/**
 * Express middleware to setup user session based on the auth token
 *
 * @export
 */
module.exports = function (pocket) {
    const userManager = pocket.users;

    return function (req, res, next) {
        const auth = req.get('authorization');
        const rexp = /^Bearer .+$/i;

        if (!auth || !rexp.test(auth)) {
            return next();
        }

        const token = auth.replace(/^Bearer /i, "");

        req.ctx = req.ctx || {};
        userManager.fromJWT(token)
            .then(user => {
                req.ctx.user = user;
                next();
            })
            .catch(() => next());
    }
}