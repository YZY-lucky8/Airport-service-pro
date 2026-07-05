/**
 * 机场问答知识库种子数据 — 160条
 * 用法: node seed-knowledge.js
 * 运行后会自动插入到 knowledge_base 表中
 */

const DbAdapter = require('./db-adapter');

const pool = DbAdapter.getInstance();

const knowledgeData = [
  // ============ 一、购票与证件（1～20）============
  { title: "第一次坐飞机要提前多久到机场", content: "国内提前2小时，国际提前3小时。第一次不熟流程，早到更安心。", category: "购票与证件", keywords: "第一次,提前多久,到机场,多长时间", priority: 80 },
  { title: "坐飞机要提前多长时间去机场", content: "国内提前2小时，国际提前3小时。", category: "购票与证件", keywords: "提前,多长时间,去机场", priority: 80 },
  { title: "几点到机场才不会误机", content: "建议国内提前2小时，国际3小时，这样办手续、安检都从容。", category: "购票与证件", keywords: "几点,误机,到机场", priority: 75 },
  { title: "买机票需要带什么证件", content: "国内用身份证，国际用护照（或通行证），证件名字必须和机票一致。", category: "购票与证件", keywords: "买机票,证件,什么证件", priority: 90 },
  { title: "坐飞机用什么证件", content: "身份证（国内）或护照（国际/港澳台）。", category: "购票与证件", keywords: "坐飞机,证件", priority: 90 },
  { title: "没有身份证能坐飞机吗", content: "可以办临时乘机证明，在机场公安窗口办理，或用护照、军官证等有效证件。", category: "购票与证件", keywords: "没有身份证,临时,乘机证明", priority: 85 },
  { title: "儿童票怎么买多大免票", content: "14天～2周岁买婴儿票（无座，成人价10%），2～12周岁买儿童票（有座，约50%）。每位成人限带一名婴儿。", category: "购票与证件", keywords: "儿童票,婴儿票,免票,小孩,多大", priority: 75 },
  { title: "带小孩坐飞机怎么买票", content: "婴儿和儿童按年龄买相应票，订票时选"儿童"或"婴儿"选项。", category: "购票与证件", keywords: "带小孩,坐飞机,买票", priority: 70 },
  { title: "多大的孩子不用买票", content: "不满两周岁的婴儿买婴儿票（有费用），没有完全免票的，但婴儿票很便宜。", category: "购票与证件", keywords: "多大,孩子,不用买票,免票", priority: 70 },
  { title: "可以帮别人买机票吗", content: "可以，但乘机人证件信息必须准确，值机时用乘机人本人证件。", category: "购票与证件", keywords: "帮别人,买机票,代买", priority: 60 },
  { title: "机票能代买吗", content: "能，提供乘机人姓名和证件号即可，但注意有些航司需本人确认。", category: "购票与证件", keywords: "机票,代买", priority: 60 },
  { title: "航班号是什么意思", content: "比如CA1234，CA是航司代码，1234是具体班次，用于查找航班。", category: "购票与证件", keywords: "航班号,意思", priority: 55 },
  { title: "机票上的字母代表什么航空公司", content: "航空公司的二字代码，CA国航、MU东航、CZ南航等。", category: "购票与证件", keywords: "CA,MU,字母,航空公司,代码", priority: 55 },
  { title: "选座位怎么选什么时候选最好", content: "购票后即可在APP或官网选，早选靠窗或过道，怕颠簸选机翼旁。", category: "购票与证件", keywords: "选座位,怎么选,什么时候", priority: 65 },
  { title: "第一次坐飞机选哪个座位好", content: "靠窗看风景，过道方便上厕所，机翼旁最稳，紧急出口腿空间大。", category: "购票与证件", keywords: "第一次,选座位,哪个,好", priority: 60 },
  { title: "怎么选靠窗的座位", content: "值机时告诉工作人员或网上选座时选A或F（大部分机型）。", category: "购票与证件", keywords: "靠窗,座位,怎么,选", priority: 60 },
  { title: "行李托运要额外花钱吗", content: "多数国内航司经济舱有免费托运额（通常20kg），廉价航空可能不含。", category: "购票与证件", keywords: "行李,托运,花钱,收费", priority: 75 },
  { title: "托运行李收费吗", content: "看购票时的行李额，有免费额就不收费，超重或廉价航要收费。", category: "购票与证件", keywords: "托运,收费", priority: 75 },
  { title: "随身能带多大的箱子", content: "一般20×40×55cm以内，重量5～8kg，各航司略有不同。", category: "购票与证件", keywords: "随身,带,箱子,大小,尺寸", priority: 65 },
  { title: "登机箱尺寸限制是多少", content: "三边之和不超过115cm，具体看航司规定。", category: "购票与证件", keywords: "登机箱,尺寸,限制", priority: 65 },

  // ============ 二、行李与随身物品（21～45）============
  { title: "充电宝能带吗能托运吗", content: "充电宝严禁托运，必须随身，额定能量不超过100Wh直接带。", category: "行李与随身", keywords: "充电宝,带,托运", priority: 90 },
  { title: "充电宝可以放行李箱里托运吗", content: "不可以，锂电池一律随身。", category: "行李与随身", keywords: "充电宝,行李箱,托运", priority: 90 },
  { title: "20000毫安的充电宝能上飞机吗", content: "可以，一般2万毫安时在100Wh以内，放心带。", category: "行李与随身", keywords: "20000,毫安,充电宝,上飞机", priority: 80 },
  { title: "液体能带多少", content: "随身每瓶不超过100ml（看瓶身容量），全部装进1升透明袋，每人限一袋。", category: "行李与随身", keywords: "液体,带,多少", priority: 85 },
  { title: "水能带吗", content: "安检前的水不能带，过了安检后买的水可以带上飞机。", category: "行李与随身", keywords: "水,带,安检", priority: 90 },
  { title: "液体可以带上飞机吗", content: "可以，但每瓶≤100ml，且要装透明袋，超量需托运。", category: "行李与随身", keywords: "液体,带上飞机", priority: 85 },
  { title: "饮料能过安检吗", content: "安检前不行，候机厅买的可以带上去。", category: "行李与随身", keywords: "饮料,安检", priority: 85 },
  { title: "化妆品能带吗", content: "可以，但同样每瓶≤100ml，总量不超过1升，需托运大瓶。", category: "行李与随身", keywords: "化妆品,带", priority: 75 },
  { title: "带护肤品上飞机有什么限制", content: "单瓶容量不超过100ml，容器本身标注容量为准。", category: "行李与随身", keywords: "护肤品,上飞机,限制", priority: 70 },
  { title: "晕机怎么办", content: "提前吃晕机药，选机翼座位，起飞前别吃太饱，看远处地平线。", category: "行李与随身", keywords: "晕机,怎么办", priority: 70 },
  { title: "坐飞机晕机怎么缓解", content: "可以咀嚼口香糖，或者用晕车贴，也可向乘务员求助。", category: "行李与随身", keywords: "晕机,缓解", priority: 70 },
  { title: "第一次坐飞机穿什么衣服好", content: "舒适宽松，平底鞋，带件薄外套，机舱温度变化大。", category: "行李与随身", keywords: "第一次,穿什么,衣服", priority: 60 },
  { title: "坐飞机穿什么鞋方便", content: "平底、方便脱的鞋，安检有时需要脱鞋检查。", category: "行李与随身", keywords: "穿什么,鞋,方便", priority: 55 },
  { title: "电子登机牌和纸质哪个好", content: "电子方便，但手机没电时纸质更保险，第一次两种都备着。", category: "行李与随身", keywords: "电子登机牌,纸质", priority: 60 },
  { title: "手机登机牌怎么用", content: "在航司APP值机后生成二维码，安检和登机时扫码即可。", category: "行李与随身", keywords: "手机,登机牌,二维码", priority: 70 },
  { title: "机票能退改签吗怎么收费", content: "看购票时的退改规则，折扣票改签费高，全价票灵活，越早改越省钱。", category: "行李与随身", keywords: "退改签,收费", priority: 75 },
  { title: "临时想改航班怎么办", content: "联系购票平台或航司客服，按规则补差价。", category: "行李与随身", keywords: "改航班", priority: 70 },
  { title: "行李超重怎么办", content: "超重按全价票1.5%/公斤收费，建议提前拿些重物随身。", category: "行李与随身", keywords: "行李,超重", priority: 80 },
  { title: "箱子超重了怎么处理", content: "可以分装到随身包，或交超重费，也可邮寄部分物品。", category: "行李与随身", keywords: "箱子,超重,处理", priority: 75 },
  { title: "宠物能带上飞机吗", content: "需提前向航司申请，办理检疫证明，装入航空箱，放在有氧货舱，导盲犬除外。", category: "行李与随身", keywords: "宠物,带上飞机", priority: 70 },
  { title: "小狗能坐飞机吗", content: "可以托运，但需要提前办手续，不能随身进客舱。", category: "行李与随身", keywords: "小狗,坐飞机,托运", priority: 65 },
  { title: "行李箱上要贴什么标识", content: "挂行李牌写上姓名、电话、邮箱，方便丢失时联系。", category: "行李与随身", keywords: "行李箱,标识,行李牌", priority: 50 },
  { title: "托运行李里能放食物吗", content: "可以放真空包装，但新鲜水果肉类有检疫限制，国际更严。", category: "行李与随身", keywords: "托运,食物", priority: 55 },
  { title: "能带水果上飞机吗", content: "国内短途可以，国际通常禁止，具体看目的地规定。", category: "行李与随身", keywords: "水果,上飞机", priority: 60 },
  { title: "指甲刀能带上飞机吗", content: "刀刃小于6cm的一般可以随身，但建议托运以免被没收。", category: "行李与随身", keywords: "指甲刀,带上飞机", priority: 50 },

  // ============ 三、值机与托运（46～65）============
  { title: "值机柜台怎么找", content: "看机场大屏幕，找到航班号，后面显示柜台字母数字，跟着指示牌走。", category: "值机与托运", keywords: "值机,柜台,找", priority: 85 },
  { title: "在哪里办登机牌", content: "出发大厅大屏幕找到你的航班柜台，去那里办理。", category: "值机与托运", keywords: "登机牌,办理", priority: 85 },
  { title: "值机是干什么的", content: "换登机牌、托运行李、选座位，就是"报到"确认你坐这趟飞机。", category: "值机与托运", keywords: "值机,干什么", priority: 80 },
  { title: "自助值机怎么用", content: "放身份证感应，按屏幕选座位打印登机牌，有行李托运还得去人工。", category: "值机与托运", keywords: "自助值机,用", priority: 75 },
  { title: "不会用自助机器怎么办", content: "旁边有工作人员协助，或者直接去人工柜台。", category: "值机与托运", keywords: "不会,自助机器", priority: 60 },
  { title: "值机截止时间是什么时候", content: "国内起飞前30～45分钟，国际45～60分钟，务必在此之前办好。", category: "值机与托运", keywords: "值机,截止,时间", priority: 85 },
  { title: "最晚什么时候办值机", content: "国内一般起飞前45分钟停止值机，各航司略有不同。", category: "值机与托运", keywords: "最晚,值机", priority: 85 },
  { title: "托运行李会给我凭证吗", content: "会在登机牌上贴行李条码，或给一张小票，保管好以便查找。", category: "值机与托运", keywords: "托运,凭证,行李", priority: 70 },
  { title: "行李托运后给我什么", content: "行李票或条码，丢失行李时要用。", category: "值机与托运", keywords: "行李,托运,给我", priority: 70 },
  { title: "值机时能选靠窗位吗", content: "可以，直接告诉工作人员，有空位就会安排。", category: "值机与托运", keywords: "值机,靠窗,座位", priority: 65 },
  { title: "多人同行能坐一起吗", content: "一起办理值机并说明，尽量安排，也可提前网上选座。", category: "值机与托运", keywords: "多人,同行,坐一起", priority: 60 },
  { title: "如果误了值机时间怎么办", content: "立刻找航司柜台，看能否改签下一班，自己原因需补差价。", category: "值机与托运", keywords: "误了,值机,时间", priority: 80 },
  { title: "错过了值机还能上飞机吗", content: "一般不能，只能改签或退票。", category: "值机与托运", keywords: "错过,值机,上飞机", priority: 80 },
  { title: "行李箱里能放电池吗", content: "不能，所有含锂电池的设备必须随身携带，严禁托运。", category: "值机与托运", keywords: "行李箱,电池,托运", priority: 85 },
  { title: "电脑能托运吗", content: "建议随身，托运易损坏，而且电池必须随身。", category: "值机与托运", keywords: "电脑,托运", priority: 70 },
  { title: "值机时需要出示什么", content: "身份证（或护照）和订单号，换登机牌。", category: "值机与托运", keywords: "值机,出示", priority: 80 },
  { title: "忘记带身份证能值机吗", content: "可在机场公安办临时乘机证明，凭证明办理。", category: "值机与托运", keywords: "忘记,身份证,值机", priority: 85 },
  { title: "托运行李重量怎么算", content: "免费额通常20kg，超重按公斤收费，具体看票面。", category: "值机与托运", keywords: "托运,行李,重量", priority: 70 },
  { title: "行李超重一点点可以通融吗", content: "一般超1-2kg可能免费，超太多会收费，看工作人员。", category: "值机与托运", keywords: "行李,超重,通融", priority: 65 },
  { title: "国际航班行李额和国内一样吗", content: "国际通常更高，但具体看航司和舱位，买票时看清。", category: "值机与托运", keywords: "国际,行李额,国内", priority: 55 },

  // ============ 四、安检流程（66～90）============
  { title: "安检要检查什么", content: "核对身份证和登机牌，扫描随身行李和身体，排查危险品。", category: "安检流程", keywords: "安检,检查", priority: 85 },
  { title: "过安检需要做什么", content: "拿出证件、登机牌，脱下厚外套，取出电脑、充电宝等单独过检。", category: "安检流程", keywords: "过安检,做什么", priority: 90 },
  { title: "安检时要把外套脱掉吗", content: "厚外套、带金属扣的腰带要脱，薄夹克一般不用。", category: "安检流程", keywords: "安检,外套,脱", priority: 75 },
  { title: "安检要脱鞋吗", content: "高帮靴或厚底鞋通常要脱，穿方便脱的鞋省时间。", category: "安检流程", keywords: "安检,脱鞋", priority: 75 },
  { title: "电脑要拿出来过安检吗", content: "需要，单独放入安检筐，因金属和电池影响扫描。", category: "安检流程", keywords: "电脑,安检", priority: 80 },
  { title: "平板电脑需要单独过检吗", content: "是的，和电脑一样，从包里拿出来放筐里。", category: "安检流程", keywords: "平板,单独,过检", priority: 70 },
  { title: "安检能带水杯吗", content: "可以带空杯子，过了安检再接水；有水的要倒掉或喝一口。", category: "安检流程", keywords: "安检,水杯", priority: 75 },
  { title: "安检时水杯里有水怎么办", content: "要么倒掉，要么当面喝一口证明不是危险液体。", category: "安检流程", keywords: "水杯,水,安检", priority: 70 },
  { title: "手机要关机吗", content: "不用，调成飞行模式或静音，放筐里过检即可。", category: "安检流程", keywords: "手机,关机", priority: 80 },
  { title: "安检时手机放哪里", content: "放随身包里过X光机，或单独放筐里。", category: "安检流程", keywords: "手机,安检", priority: 75 },
  { title: "戴金属饰品要摘吗", content: "小戒指项链通常不用，但大件（皮带、手表）建议提前摘。", category: "安检流程", keywords: "金属,饰品,摘", priority: 55 },
  { title: "安检响铃怎么办", content: "配合安检员，用探测仪复查，可能是金属扣子等，不用紧张。", category: "安检流程", keywords: "安检,响铃", priority: 70 },
  { title: "打火机能带吗", content: "不能，安检前自觉丢弃或交送行人。", category: "安检流程", keywords: "打火机,带", priority: 80 },
  { title: "火柴能带上飞机吗", content: "同样不能，易燃品禁止携带。", category: "安检流程", keywords: "火柴,带上飞机", priority: 60 },
  { title: "电动剃须刀能带吗", content: "锂电池剃须刀随身，不带电池的可以托运。", category: "安检流程", keywords: "电动剃须刀,带", priority: 55 },
  { title: "喷雾发胶能带吗", content: "每瓶不超过100ml，且需在透明袋内，超量托运。", category: "安检流程", keywords: "喷雾,发胶,带", priority: 60 },
  { title: "药品怎么带", content: "固体药片随便带，液体药需有处方或原包装，超100ml要申报。", category: "安检流程", keywords: "药品,带", priority: 65 },
  { title: "带中药丸可以吗", content: "可以，固体的没问题，液体需合规。", category: "安检流程", keywords: "中药丸,带", priority: 50 },
  { title: "安检能带雨伞吗", content: "折叠伞可以随身，长柄伞可能需要托运。", category: "安检流程", keywords: "安检,雨伞,带", priority: 55 },
  { title: "安检时被抽查开箱麻烦吗", content: "不麻烦，配合检查，工作人员会当面翻看，不会乱扔。", category: "安检流程", keywords: "抽查,开箱", priority: 50 },
  { title: "安检通道有男女之分吗", content: "一般没有，但身体检查由同性安检员操作。", category: "安检流程", keywords: "安检,男女", priority: 40 },
  { title: "安检区域能拍照吗", content: "通常禁止，请遵守规定。", category: "安检流程", keywords: "安检,拍照", priority: 40 },
  { title: "过安检时紧张出错怎么办", content: "别慌，安检员会耐心指导，照做就行。", category: "安检流程", keywords: "紧张,出错,安检", priority: 45 },
  { title: "安检后登机牌丢了怎么办", content: "去值机柜台或问询处凭身份证补打。", category: "安检流程", keywords: "登机牌,丢了", priority: 70 },
  { title: "安检排队时提前准备什么", content: "拿出身份证和登机牌，提前取出电脑、充电宝、液体袋，脱掉外套，更快通过。", category: "安检流程", keywords: "排队,提前,准备", priority: 80 },

  // ============ 五、候机与登机（91～115）============
  { title: "安检后怎么找登机口", content: "看登机牌上的号码，跟着指示牌找，也可看大屏幕或问工作人员。", category: "候机与登机", keywords: "登机口,找", priority: 90 },
  { title: "登机口怎么走", content: "机场有明确标识，按箭头方向走。", category: "候机与登机", keywords: "登机口,走", priority: 85 },
  { title: "登机口会变吗", content: "有可能临时改变，多留意广播和显示屏，别走远。", category: "候机与登机", keywords: "登机口,变", priority: 80 },
  { title: "候机时能做什么", content: "逛免税店、吃饭、充电、看书，留意广播通知。", category: "候机与登机", keywords: "候机,做什么", priority: 60 },
  { title: "登机时间是什么时候", content: "登机牌上写有开始登机时间，通常比起飞早20～40分钟。", category: "候机与登机", keywords: "登机,时间", priority: 85 },
  { title: "几点开始登机", content: "看登机牌，一般在起飞前半小时左右。", category: "候机与登机", keywords: "几点,登机", priority: 85 },
  { title: "如果去洗手间错过登机怎么办", content: "登机持续约20分钟，广播会多次通知，别去太远。", category: "候机与登机", keywords: "错过,登机", priority: 65 },
  { title: "登机排队顺序是什么", content: "先头等舱/商务舱、带小孩或需帮助的，然后经济舱按后排到前排叫号。", category: "候机与登机", keywords: "登机,排队,顺序", priority: 60 },
  { title: "什么时候轮到我登机", content: "听广播叫号，或看显示屏提示。", category: "候机与登机", keywords: "轮到我,登机", priority: 70 },
  { title: "登机时要出示什么", content: "登机牌和身份证（有时只看登机牌），扫描二维码。", category: "候机与登机", keywords: "登机,出示", priority: 75 },
  { title: "登机只带手机二维码可以吗", content: "可以，电子登机牌扫描即可。", category: "候机与登机", keywords: "手机,二维码,登机", priority: 70 },
  { title: "行李箱放不进头顶行李架怎么办", content: "乘务员会协助，放不下可免费机舱门口托运，下机时在舱门口取。", category: "候机与登机", keywords: "行李箱,行李架", priority: 65 },
  { title: "登机后怎么找座位", content: "登机牌写有"22A"等，看座位上方的排号，对照找。", category: "候机与登机", keywords: "找座位", priority: 80 },
  { title: "我的座位号怎么看", content: "如"22A"表示22排A座（靠窗），字母代表左右。", category: "候机与登机", keywords: "座位号", priority: 75 },
  { title: "包放哪里", content: "小包放座位下或前方口袋，大件放头顶行李架。", category: "候机与登机", keywords: "包,放", priority: 60 },
  { title: "安全带怎么系", content: "和汽车一样，插入扣中拉紧，抬起卡扣解开，乘务员会演示。", category: "候机与登机", keywords: "安全带,系", priority: 70 },
  { title: "飞机安全带怎么解开", content: "抬一下金属扣上的卡板即可。", category: "候机与登机", keywords: "安全带,解开", priority: 60 },
  { title: "起飞前手机关机吗", content: "现在多数允许飞行模式，但需关闭蜂窝网络，按广播执行。", category: "候机与登机", keywords: "手机,关机,起飞", priority: 80 },
  { title: "飞机上能用手机吗", content: "开飞行模式可用，但禁止打电话（除非机上WiFi）。", category: "候机与登机", keywords: "飞机,手机", priority: 85 },
  { title: "起飞前为什么要调直座椅靠背", content: "为了紧急撤离时通道畅通，安全规定，请配合。", category: "候机与登机", keywords: "调直,座椅靠背", priority: 50 },
  { title: "小桌板为什么要收起", content: "防止碰撞，确保逃生空间。", category: "候机与登机", keywords: "小桌板,收起", priority: 50 },
  { title: "起飞前为什么打开遮光板", content: "让眼睛适应外界光线，便于观察外部异常。", category: "候机与登机", keywords: "遮光板,打开", priority: 50 },
  { title: "起飞时耳朵疼怎么办", content: "吞咽、打哈欠、嚼口香糖、捏鼻鼓气，都能缓解。", category: "候机与登机", keywords: "耳朵疼,起飞", priority: 75 },
  { title: "耳朵疼怎么快速缓解", content: "做吞咽动作或用力打哈欠最有效。", category: "候机与登机", keywords: "耳朵疼,缓解", priority: 75 },
  { title: "飞机起飞时紧张怎么办", content: "深呼吸，脚放平，握扶手，闭眼听音乐，几秒就平稳。", category: "候机与登机", keywords: "紧张,起飞", priority: 65 },

  // ============ 六、飞行途中（116～140）============
  { title: "飞机上提供什么吃的", content: "短途小零食饮料，长途正餐（米饭/面条），特殊餐需提前预订。", category: "飞行途中", keywords: "飞机,吃的,餐食", priority: 70 },
  { title: "飞机上有免费餐食吗", content: "大部分全服务航司免费，廉价航空可能收费，问乘务员。", category: "飞行途中", keywords: "免费,餐食", priority: 70 },
  { title: "饮料免费吗", content: "一般免费，可续杯，廉价航可能收费。", category: "飞行途中", keywords: "饮料,免费", priority: 65 },
  { title: "能要第二份饭吗", content: "如果有剩余，乘务员会给，但通常每人一份。", category: "飞行途中", keywords: "第二份,饭", priority: 40 },
  { title: "飞机上能上厕所吗", content: "可以，起飞降落和颠簸时禁用，看指示灯。", category: "飞行途中", keywords: "上厕所,飞机", priority: 70 },
  { title: "飞机卫生间怎么冲水", content: "按按钮或感应，不要扔纸巾以外杂物。", category: "飞行途中", keywords: "卫生间,冲水", priority: 40 },
  { title: "飞机上能吸烟吗", content: "绝对禁止，包括电子烟，违者重罚。", category: "飞行途中", keywords: "吸烟,飞机", priority: 85 },
  { title: "可以抽电子烟吗", content: "不可以，烟雾报警很敏感。", category: "飞行途中", keywords: "电子烟", priority: 80 },
  { title: "飞机上有WiFi吗", content: "部分航司提供，问乘务员或看座椅口袋指南。", category: "飞行途中", keywords: "WiFi,飞机", priority: 65 },
  { title: "怎么连接机上WiFi", content: "按说明连接，可能需付费或限时。", category: "飞行途中", keywords: "连接,WiFi", priority: 50 },
  { title: "空调出风口怎么调", content: "头顶有旋钮，可调大小和方向，怕冷就关小。", category: "飞行途中", keywords: "空调,出风口", priority: 45 },
  { title: "飞机上冷怎么办", content: "要毛毯（数量有限）或自带外套。", category: "飞行途中", keywords: "冷,飞机", priority: 55 },
  { title: "飞机颠簸时怎么办", content: "立即回座系好安全带，别走动，颠簸常见，很安全。", category: "飞行途中", keywords: "颠簸", priority: 80 },
  { title: "遇到颠簸会掉下来吗", content: "不会，飞机结构坚固，听从乘务员指令。", category: "飞行途中", keywords: "颠簸,掉", priority: 70 },
  { title: "飞行中能看窗外吗", content: "可以，但阳光刺眼时拉下遮光板。", category: "飞行途中", keywords: "看窗外", priority: 30 },
  { title: "能和乘务员聊天吗", content: "简短问可以，别长时间聊，影响工作。", category: "飞行途中", keywords: "乘务员,聊天", priority: 30 },
  { title: "飞行中能吃药吗", content: "可以，要温水按呼唤铃。", category: "飞行途中", keywords: "吃药", priority: 50 },
  { title: "身体突然不舒服怎么办", content: "按呼唤铃，乘务员有急救箱，会广播找医生。", category: "飞行途中", keywords: "不舒服", priority: 70 },
  { title: "广播听不懂怎么办", content: "中英文各播一遍，听关键词即可。", category: "飞行途中", keywords: "广播", priority: 40 },
  { title: "飞行中能打开行李架吗", content: "平稳时可以，颠簸时不要开，注意物品掉落。", category: "飞行途中", keywords: "行李架,打开", priority: 40 },
  { title: "能带自己的食物吃吗", content: "可以，但不要有浓烈气味（如泡面、榴莲）。", category: "飞行途中", keywords: "自己的食物", priority: 50 },
  { title: "飞机上能泡面吗", content: "一般不方便，且味道大，不建议。", category: "飞行途中", keywords: "泡面", priority: 40 },
  { title: "第一次坐飞机怎么打发时间", content: "看电影、听歌、看云海、睡觉，时间很快。", category: "飞行途中", keywords: "第一次,打发时间", priority: 50 },
  { title: "飞机上可以充电吗", content: "部分座位有USB或插座，没有就用充电宝。", category: "飞行途中", keywords: "充电,飞机", priority: 65 },
  { title: "飞行中能换座位吗", content: "起飞后如有空位可问乘务员，紧急出口排需同意。", category: "飞行途中", keywords: "换座位", priority: 50 },

  // ============ 七、降落与下机（141～160）============
  { title: "降落前要做什么", content: "调直靠背、收起小桌板、打开遮光板、系好安全带。", category: "降落与下机", keywords: "降落,做什么", priority: 80 },
  { title: "降落时耳朵也疼吗", content: "同样会疼，用吞咽、打哈欠缓解，落地后几分钟消失。", category: "降落与下机", keywords: "降落,耳朵疼", priority: 70 },
  { title: "飞机落地后能马上站起来吗", content: "不能，滑行时可能急刹车，等安全带指示灯熄灭再起。", category: "降落与下机", keywords: "落地,站起来", priority: 70 },
  { title: "下机时怎么取托运行李", content: "到行李提取大厅，看大屏幕找航班对应转盘号，等箱子出来。", category: "降落与下机", keywords: "取行李,下机", priority: 85 },
  { title: "行李在哪里取", content: "到达厅的行李转盘，看显示屏找到你的航班号。", category: "降落与下机", keywords: "行李,取", priority: 85 },
  { title: "如果行李找不到怎么办", content: "去行李查询柜台，出示登机牌和行李条，填单，航司会找。", category: "降落与下机", keywords: "行李,找不到", priority: 80 },
  { title: "下机后要过海关吗", content: "国际到达需要过边防和海关，国内直接出到达厅。", category: "降落与下机", keywords: "海关,下机", priority: 70 },
  { title: "接机人在哪里等我", content: "国内到达出口在一楼，可约在指定出口或星巴克等显眼处。", category: "降落与下机", keywords: "接机", priority: 60 },
  { title: "下机后能长时间逗留吗", content: "可以，但到达区不能过夜，可去咖啡厅。", category: "降落与下机", keywords: "逗留", priority: 30 },
  { title: "下机后头晕怎么办", content: "正常，慢慢走，找座休息，喝水缓解。", category: "降落与下机", keywords: "头晕,下机", priority: 50 },
  { title: "在机场迷路了怎么办", content: "找穿制服的工作人员或问询台，或用手机导航。", category: "降落与下机", keywords: "迷路,机场", priority: 65 },
  { title: "中转航班怎么走", content: "看"中转"指示，不用出隔离区，直接去下个登机口。", category: "降落与下机", keywords: "中转", priority: 70 },
  { title: "中转时间要多长", content: "国内至少1.5小时，国际2～3小时，第一次更长些。", category: "降落与下机", keywords: "中转,时间", priority: 65 },
  { title: "延误了怎么办", content: "留在候机区听通知，航司会安排餐食或住宿，留意广播。", category: "降落与下机", keywords: "延误", priority: 80 },
  { title: "航班取消怎么办", content: "去航司柜台改签或退票，工作人员会安排。", category: "降落与下机", keywords: "取消,航班", priority: 85 },
  { title: "第一次坐飞机要注意什么", content: "提前到、听广播、看指示，不懂就问，享受飞行。", category: "降落与下机", keywords: "第一次,注意", priority: 75 },
  { title: "坐飞机安全吗", content: "非常安全，飞机是事故率最低的交通工具之一。", category: "降落与下机", keywords: "安全,坐飞机", priority: 70 },
  { title: "孕妇能坐飞机吗", content: "32周以内可，32～36需医生证明，36周以上一般不载。", category: "降落与下机", keywords: "孕妇,坐飞机", priority: 65 },
  { title: "带宝宝坐飞机要注意什么", content: "起飞降落喂奶或安抚奶嘴缓解耳压，申请婴儿摇篮，带足尿不湿。", category: "降落与下机", keywords: "带宝宝,坐飞机", priority: 60 },
  { title: "能带婴儿车上飞机吗", content: "可以托运或在登机口交给工作人员，下机时取。", category: "降落与下机", keywords: "婴儿车,上飞机", priority: 55 },
];

async function seedKnowledge() {
  console.log('📚 开始导入知识库种子数据...');
  
  // Clear existing data
  await pool.query('DELETE FROM knowledge_base');
  console.log('  已清空旧数据');
  
  let inserted = 0;
  for (const item of knowledgeData) {
    try {
      await pool.query(
        `INSERT INTO knowledge_base (title, content, category, keywords, priority, is_active) 
         VALUES (?, ?, ?, ?, ?, 1)`,
        [item.title, item.content, item.category, item.keywords, item.priority]
      );
      inserted++;
    } catch (err) {
      console.error(`  ❌ 插入失败: ${item.title}`, err.message);
    }
  }
  
  console.log(`✅ 成功导入 ${inserted}/${knowledgeData.length} 条知识库记录`);
  
  // Verify
  const [[count]] = await pool.query('SELECT COUNT(*) as total FROM knowledge_base WHERE is_active = 1');
  console.log(`📊 当前知识库有效记录总数: ${count.total}`);
  
  // Show categories
  const [cats] = await pool.query('SELECT category, COUNT(*) as cnt FROM knowledge_base WHERE is_active = 1 GROUP BY category');
  console.log('\n📂 分类统计:');
  for (const c of cats) {
    console.log(`   ${c.category}: ${c.cnt} 条`);
  }
  
  process.exit(0);
}

seedKnowledge().catch(err => {
  console.error('❌ 种子数据导入失败:', err);
  process.exit(1);
});
