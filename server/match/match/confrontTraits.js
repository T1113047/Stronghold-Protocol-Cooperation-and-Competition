// server/match/match/confrontTraits.js — 狩猎期「特性分档表」(2V2).
//
// The 狩猎期 values a monster by its stats AND by its traits: every enemy of the confront pool carries a grade
// 1 / 2 / 3 assigned by a trait review (2026-10-17; 4 parallel reviewers on a shared rubric, then a consistency
// pass over the cross-cutting questions — unconditional enemy-buff auras count as 3, single-target damage-over-time
// as 2, and "only inside a specific terrain / with a specific ally" effects drop one grade). The 特性 VALUE is an
// absolute addend: `step × (grade − 1)`, with `step` calibrated per round so the graded part is exactly
// `VERSUS_CONFRONT.traitShare` (30 %) of the whole value table — see confront.js confrontTraitStep.
//
// Grade 1 = ≈a stat stick (no abilities/talents/skills, or a flavour-text only desc) → no 特性 addend.
// Grade 2 = a real but not game-changing mechanic (conditional buffs, single-target DoT / elemental damage,
//           self-heal, stealth-only effects, a conditional aura …).
// Grade 3 = a game-changing mechanic (summon / split / death-spawn, revive, area or zone damage, hard control,
//           an unconditional enemy buff aura, a strong self-buff …). FLYING is NOT a trait here — it is already
//           priced as 2 blocks in confrontValue.
//
// 120 pool enemies: 27 grade 1 / 53 grade 2 / 40 grade 3. An enemy missing from the table reads as
// grade 1 (test/match/confront-traits.test.js fails when the pool gains one, so the table stays complete).

export const CONFRONT_TRAIT_GRADE = Object.freeze({
  'enemy_1000_gopro_2': 1, // 猎狗pro — 无特性，纯数值快速猎狗
  'enemy_10031_cnvsld': 2, // 业余竞演者 — 隐匿，被阻挡前不可被攻击
  'enemy_10034_cnvsax': 2, // 节日爵士乐手 — 技能持续造成法术与灼燃损伤
  'enemy_10042_prtrop': 2, // 架桥船工 — 隐匿，可架桥开辟通路
  'enemy_10042_prtrop_2': 2, // 扶桥老手 — 隐匿，可架桥开辟通路
  'enemy_10043_sailor': 1, // 寻险水手 — 仅过桥时短暂加速，近乎无特性
  'enemy_1005_yokai': 1, // 妖怪 — 仅飞行不攻击，无其他特性
  'enemy_1005_yokai_2': 1, // 妖怪MKII — 仅飞行远程射击，无特性
  'enemy_1005_yokai_3': 1, // 威龙 — 仅飞行，无其他机制特性
  'enemy_10065_ftzlc': 2, // 卷心籽 — 被点燃后死亡爆炸，条件苛刻
  'enemy_10067_ftsjc': 3, // 灼藤 — 首击范围法术伤害并附加灼燃损伤
  'enemy_1006_shield_3': 1, // 重装五十夫长 — 无特性，纯高防高血肉盾
  'enemy_10083_hlbird': 2, // “萨科塔之翼” — 半血恐惧加速冲刺，非硬控
  'enemy_10084_hlegle': 2, // “萨科塔之眼” — 夺弹药干扰，限弹药类干员
  'enemy_1009_lurker': 2, // 潜伏者 — 隐匿，被阻挡前不可被攻击
  'enemy_1010_demon': 1, // 萨卡兹大剑手 — 无特性，纯数值萨卡兹剑手
  'enemy_1010_demon_2': 1, // 萨卡兹大剑组长 — 无特性，纯数值精英剑手
  'enemy_10122_uacann_2': 3, // 集团军重型火炮 — 攻击留下燃烧区域，持续伤害
  'enemy_10124_uashld_2': 2, // 集团军中坚盾卫 — 嘲讽阻挡多人，条件性减伤
  'enemy_1017_defdrn': 3, // 御4 — 飞行并持续为周围敌军加防
  'enemy_1019_jshoot': 2, // 隐形弩手 — 隐匿，被阻挡前不可被攻击
  'enemy_1019_jshoot_2': 2, // 隐形弩手组长 — 隐匿，被阻挡前不可被攻击
  'enemy_1040_bombd': 3, // 暴鸰 — 投掷炸弹造成群体物理伤害
  'enemy_1041_lazerd': 1, // 法术大师A1 — 仅飞行，远程法术无特性
  'enemy_1041_lazerd_2': 1, // 法术大师A2 — 仅飞行，远程法术无特性
  'enemy_1042_frostd': 3, // 寒霜 — 飞行且持续大降周围干员攻速
  'enemy_1043_zomsbr': 2, // 宿主士兵 — 能自然回血，非高额自愈
  'enemy_1045_hammer': 3, // 粉碎攻坚手 — 数次攻击后晕眩目标，硬控
  'enemy_1045_hammer_2': 3, // 粉碎攻坚组长 — 数次攻击后晕眩目标，硬控
  'enemy_1046_agent': 1, // 步兵 — 无特性，纯数值近战步兵
  'enemy_1061_zomshd': 2, // 宿主重装士兵 — 自然回血，持续自愈拖时间
  'enemy_1071_dftman': 1, // 萨卡兹刀兵 — 无特性天赋技能，仅高法抗
  'enemy_1072_dlancer': 2, // 萨卡兹穿刺手 — 移动加速，首次攻击按移速加伤
  'enemy_1112_emppnt': 1, // 帝国炮火先兆者 — 仅飞行，无其他特性
  'enemy_1116_liprr': 2, // 普通囚犯 — 禁锢解放两段，解放后增攻
  'enemy_1116_liprr_2': 2, // 老练囚犯 — 禁锢解放两段，解放后增攻
  'enemy_1118_lidbox_2': 2, // 拳师囚犯 — 解放后增攻并破防穿甲
  'enemy_1119_vofsd': 2, // 强壮囚犯 — 解放后增攻加法抗并回血
  'enemy_1121_lifbos': 2, // 重犯 — 首次解放时同时解放全场敌人
  'enemy_1121_lifbos_2': 2, // 传奇重犯 — 首次解放时同时解放全场敌人
  'enemy_1148_dssbr': 2, // 底海滑动者 — 攻击附加神经损伤
  'enemy_1148_dssbr_2': 2, // 富营养的滑动者 — 攻击附加神经损伤
  'enemy_1158_divman': 1, // 潜水员 — 仅水中隐匿增攻，地形条件苛刻
  'enemy_1160_hvyslr': 3, // 码头水手 — 数次攻击后眩晕我方，硬控
  'enemy_1160_hvyslr_2': 3, // 码头水手长 — 数次攻击后眩晕我方，硬控
  'enemy_1161_tidmag': 3, // 控潮术师 — 攻击波及周围四格，范围伤害
  'enemy_1161_tidmag_2': 3, // 领潮员 — 攻击波及周围四格，范围伤害
  'enemy_1165_duhond': 2, // 深池侦察犬 — 折射生效时法抗提升，减伤
  'enemy_1166_dusbr': 2, // 深池侦察兵 — 折射生效时法抗提升，减伤
  'enemy_1166_dusbr_2': 2, // 深池侦察队长 — 折射生效时法抗提升，减伤
  'enemy_1168_dumage': 2, // 深池暗影术师 — 折射生效时法抗提升，减伤
  'enemy_1169_duphlx': 2, // 深池方阵步兵 — 折射减伤，友军相邻时叠防
  'enemy_1169_duphlx_2': 2, // 深池方阵指挥官 — 折射减伤，友军相邻时叠防
  'enemy_1170_dushld': 2, // 深池重甲卫士 — 折射生效时法抗提升，减伤
  'enemy_1170_dushld_2': 2, // 深池重甲卫士队长 — 折射生效时法抗提升，减伤
  'enemy_1172_dugago': 3, // 守墓石像 — 首次击倒化石像后重生，复活
  'enemy_1174_duholy': 2, // 深池伙友卫队 — 折射减伤，特定友军在场降攻速
  'enemy_1174_duholy_2': 2, // 深池伙友卫队精英 — 折射减伤，特定友军在场降攻速
  'enemy_1175_dushdo_2': 2, // 深池伙友影刃精英 — 隐匿，特定友军在场大幅提速
  'enemy_1195_sfyin': 3, // 磨砻 — 被击倒后生成两个木制瑞印
  'enemy_1195_sfyin_2': 3, // 明鉴 — 被击倒生成2个瑞印，召唤分裂
  'enemy_1197_sfshu': 3, // 俗心 — 被击倒生成3个卷轴，召唤分裂
  'enemy_1197_sfshu_2': 3, // 雅气 — 被击倒生成3个卷轴，召唤分裂
  'enemy_1199_sfjin': 3, // 身观 — 被击倒生成青铜镜，死亡召唤
  'enemy_1207_sfji': 3, // 沉沙 — 断刃自我增伤，死亡生成单位
  'enemy_1229_darmy': 2, // 萨卡兹王庭军战士 — 攻击附凋亡损伤，单体附加
  'enemy_1229_darmy_2': 2, // 萨卡兹王庭军精锐战士 — 攻击附凋亡损伤，单体附加
  'enemy_1234_dsubrl': 3, // 深溟巢涌者 — 范围持续法伤与神经损伤
  'enemy_1234_dsubrl_2': 3, // 富营养的巢涌者 — 范围持续法伤与神经损伤
  'enemy_1249_lysdb_2': 2, // 莱茵生命防卫科高级成员 — 仅抵挡一次物法伤害，小护盾
  'enemy_1251_lysyta': 1, // Dor-1号失败品 — 仅对特定动力装甲生效，近乎无特性
  'enemy_1251_lysyta_2': 1, // Dor-α号失败品 — 仅对特定动力装甲生效，近乎无特性
  'enemy_1252_lysytb_2': 1, // Dor-β号复制体 — 仅对特定动力装甲生效，近乎无特性
  'enemy_1254_lypa_2': 1, // 测试用动力装甲 — 无特性天赋技能，纯数值装甲
  'enemy_1267_nhpbr': 3, // 萨卡兹枯朽战士 — 死亡释放秽蚀，持续范围伤害
  'enemy_1267_nhpbr_2': 3, // 萨卡兹枯朽战士组长 — 死亡释放秽蚀，持续范围伤害
  'enemy_1270_nhstlk': 2, // 逐腐兽 — 攻击致单体持续法伤，可被治疗解除
  'enemy_1270_nhstlk_2': 2, // 疯狂的逐腐兽 — 攻击致单体持续法伤，可被治疗解除
  'enemy_1272_nhtank': 3, // 萨卡兹枯朽战车 — 数次攻击后释放范围污染秽蚀
  'enemy_1272_nhtank_2': 3, // 尖端萨卡兹枯朽战车 — 数次攻击后释放范围污染秽蚀
  'enemy_1275_dwlock_2': 3, // 萨卡兹王庭军精锐术师 — 锁定持续伤害并群体凋亡损伤
  'enemy_1283_sgkill': 2, // 家族灭迹人 — 隐匿，清算时刻条件性增强
  'enemy_1288_duskls': 3, // 深池逐火战士 — 倒下变余烬后重生，等同复活
  'enemy_1288_duskls_2': 3, // 深池逐火精锐战士 — 倒下变余烬后重生，等同复活
  'enemy_1292_duskld': 3, // 深池逐火护卫 — 可重生且地形下减伤
  'enemy_1299_ymkilr': 2, // 山海众头目 — 隐匿，破隐后单次攻击增伤
  'enemy_1299_ymkilr_2': 2, // 山海众秘使 — 隐匿，破隐后单次攻击增伤
  'enemy_1305_mhslim': 2, // 灼热源石虫 — 攻击附灼燃损伤，单体附加
  'enemy_1305_mhslim_2': 2, // 炽焰源石虫 — 攻击附灼燃损伤，单体附加
  'enemy_1320_wdrrl_2': 3, // 萨卡兹悖谬暴虐兵长 — 需阻挡三，首击溅射范围伤害
  'enemy_1325_cbgpro': 1, // 军用猎狗 — 三项特性全空，纯数值猎狗
  'enemy_1325_cbgpro_2': 1, // 高级军用猎狗 — 三项特性全空，纯数值猎狗
  'enemy_1328_cbjedi': 2, // 弧光锋卫 — 失衡位移自伤，仅法术攻击
  'enemy_1329_cbshld': 2, // 弧光镜卫 — 受击递减的高防抗，条件减伤
  'enemy_1329_cbshld_2': 2, // 弧光镜卫长 — 受击递减的高防抗，条件减伤
  'enemy_1355_mrfly': 3, // 护障 — 为周围敌军提供法抗减伤光环
  'enemy_1355_mrfly_2': 3, // 护障·P — 为周围敌军提供法抗减伤光环
  'enemy_1381_winman': 1, // 访问团新兵 — 无特性，描述仅风味文字
  'enemy_1381_winman_2': 1, // 访问团老兵 — 无特性，描述仅风味文字
  'enemy_1387_winshd': 1, // 访问团持盾者 — 需封冻地形才加防，条件苛刻
  'enemy_1389_winbab_2': 2, // 访问团强攻冠军 — 隐匿，仅优先攻击特定目标
  'enemy_1402_tgshd_2': 2, // 重装侦察兵 — 被攻击时使攻击者暴露易伤
  'enemy_1404_msnip': 3, // 重弩突袭者 — 同行列直击附带眩晕硬控
  'enemy_1407_hummbd': 2, // 远眺 — 阵亡后使周围我方暴露易伤
  'enemy_1422_lrsldr': 1, // 萨卡兹枯朽前锋 — 仅污染区内转法术，地形受限
  'enemy_1422_lrsldr_2': 1, // 萨卡兹枯朽辟路前锋 — 仅污染区内转法术，地形受限
  'enemy_1425_lrcmra': 3, // 孽罪奇美拉 — 受污染后持续生成污染伤害区
  'enemy_1425_lrcmra_2': 3, // 渎罪奇美拉 — 受污染后持续生成污染伤害区
  'enemy_1427_lrnazg': 3, // “灵幛” — 攻击对周围所有单位范围伤害
  'enemy_1433_dsbasi': 1, // 单核掠食者 — 三项特性全空，纯数值海怪
  'enemy_1433_dsbasi_2': 1, // 异光体掠食者 — 三项特性全空，纯数值海怪
  'enemy_1439_dslntf': 3, // 元核孽生者 — 临战后提速并持续神经损伤
  'enemy_2021_syfish': 2, // 骨海漂流体 — 普攻附带侵蚀损伤，单体附加
  'enemy_2025_syufo': 2, // 掠海漂移体 — 普攻附带侵蚀损伤，单体附加
  'enemy_9006_actoxi': 3, // 假想敌：蚀裂 — 阵亡后生成持续法伤毒雾区
  'enemy_9007_acelem': 3, // 假想敌：淤困 — 寄生持续法伤且元素爆发扩散
  'enemy_9008_acbunn': 2, // 假想敌：骨刺 — 隐匿下同时攻击三目标
  'enemy_9009_acfort': 3, // 假想敌：黑云 — 束缚硬控加全弹范围伤害
  'enemy_9010_acpupp': 3, // 假想敌：再生 — 阵亡给周围护盾且可复活
  'enemy_9011_acrefr': 2, // 假想敌：镜膜 — 折射期间条件性大幅增血
});

/** The 特性 grade (1..3) of an enemy; anything not in the table is grade 1 (≈ no traits). */
export function confrontTraitGrade(enemyKey) {
  const g = CONFRONT_TRAIT_GRADE[enemyKey];
  return g === 1 || g === 2 || g === 3 ? g : 1;
}
