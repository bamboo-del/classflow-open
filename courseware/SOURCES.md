# 第一期 · 智慧水利与国防

双击 `01-water-defense.html` 可离线打开。在 ClassFlow 的“小组演示”上传同一文件可跨设备播放。左右方向键翻页，章节菜单跳页，点击“讲稿”查看每页讲述提示。“暂停动画”保留当前画面。全屏嵌入时用 ClassFlow 播放器上方按钮。共 19 页，按讲稿与互动节奏约 18–20 分钟。

## 内容依据

- [盐田档案与史志信息网 · 1938 年 6 月 9 日花园口决堤记录](https://www.yantian.gov.cn/ytdayszxxw/lsjt/content/post_11736702.html)。用于日期、人工决堤、战争背景与平民受灾。正文不使用单一口径的伤亡数字。
- [《国家水网建设规划纲要》](https://www.mee.gov.cn/zcwj/zyygwj/202305/t20230529_1031583.shtml)。用于水网功能、数字孪生以及“预报、预警、预演、预案”的政策语境。课件中的村庄与时间滑块属于课堂情景，不能用于实际调度。
- [红十字国际委员会 · 1977 年《第一附加议定书》第 56 条](https://ihl-databases.icrc.org/en/ihl-treaties/api-1977/article-56)。用于说明适用条件下对含危险力量工程的专门保护。该条另有适用条件与例外，不用于追溯判断 1938 年事件。
- [山东地情档案 · 黄河整修改建](https://shandong-chorography.org/database/a/section/21/article/74/)。用于归故前的复堤背景与 1947 年 3 月堵口合龙。
- [应急管理部 · 2023 年 7 月全国自然灾害情况](https://www.mem.gov.cn/xw/yjglbgzdt/202308/t20230804_458461.shtml)。用于海河流域降雨、编号洪水及启用蓄滞洪区的背景。
- [北京市水务局 · 京津冀海河洪水复盘](https://swj.beijing.gov.cn/swdt/ztzl/hczzl/zydt/202310/t20231027_3288746.html)。用于会商、信息共享和联合调度的案例讨论。
- [国防部 · 京津冀抗洪抢险一线](https://www.mod.gov.cn/gfbw/wzll/mbyby/16242576.html)。用于部队官兵和民兵参加抢险与群众转移的案例。课堂洪水过程线、医院供水及测站失联情景均为教学示意。

## 视觉与动效

- GPT Image 四章视觉稿确定配色、排版和图形位置。课件以文字、SVG 和 Canvas 实现。史实和曲线内容由课堂材料单独编写。
- [Refero · Auros DESIGN.md](https://styles.refero.design/style/21cfe0c1-778d-4613-9f47-a5718eb929b3)。开场与结语采用深青色面、冷青水波和少量粉色强调。
- [Refero · Steep DESIGN.md](https://styles.refero.design/style/75fdb89f-ca64-41b3-af36-7a78bd09448e)。历史页采用暖纸与桃色、衬线标题和横向时间轴。
- [Refero · SuperHi Plus DESIGN.md](https://styles.refero.design/style/a1f9e844-c4b6-4526-9cfc-81208c50aee1)。技术页采用钴蓝与冰白对分版式，洪水过程线分两段描出。
- [Refero · Contra DESIGN.md](https://styles.refero.design/style/1608cf19-b249-46d4-bd37-b4c6a7fc4b56)。互动页采用淡紫、亮黄绿和珊瑚色区分输入、结果和反馈。
- 本地 `D:\动画\旋转盘\items\002-stripe-motion\README.md` 和 `motion.js`。封面和结尾使用 waves 波束公式。水网依赖页使用 orbit 粒子投影。国防保障页使用 rays 射线和沿线粒子。保留暂停、隐藏页面停帧及 reduced-motion 策略，改用青色与少量粉色，减少采样数。分步卡片使用同库 billing 的错峰节奏。
- 早期自制课件播放器。采用章节跳转、键盘翻页与逐页讲稿的交互组织。此课件的运行依赖都内嵌在同一 HTML。
