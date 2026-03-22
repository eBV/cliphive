import { router } from "./init.js";
import { mediaRouter } from "./routers/media.router.js";
import { clipRouter } from "./routers/clip.router.js";
import { renderRouter } from "./routers/render.router.js";
import { publishRouter } from "./routers/publish.router.js";
import { analyticsRouter } from "./routers/analytics.router.js";
import { templateRouter } from "./routers/template.router.js";
import { trendingRouter } from "./routers/trending.router.js";
import { accountRouter } from "./routers/account.router.js";
import { userRouter } from "./routers/user.router.js";

export const appRouter = router({
  media: mediaRouter,
  clip: clipRouter,
  render: renderRouter,
  publish: publishRouter,
  analytics: analyticsRouter,
  template: templateRouter,
  trending: trendingRouter,
  account: accountRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;
