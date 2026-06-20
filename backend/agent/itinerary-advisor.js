/**
 * ============================================================
 * 行程建议生成器 (Itinerary Advisor)
 * 基于航班信息 + 旅客偏好 + 机场设施 POI 数据库
 * ============================================================
 *
 * 功能：
 * - 根据登机口 + 起飞时间计算剩余时间
 * - 根据偏好（餐饮/购物）推荐附近设施
 * - 生成自然语言行程建议
 */

class ItineraryAdvisor {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * 主方法：生成个性化行程建议
   * @param {Object} params
   *   - flight_no: 航班号
   *   - gate: 登机口
   *   - departure_time: 起飞时间 (ISO string 或 Date)
   *   - now: 当前时间
   *   - pref_food: 是否需要餐饮
   *   - pref_shop: 是否需要购物
   * @returns {string} 自然语言建议
   */
  async generate(params) {
    const { flight_no, gate, departure_time, now = new Date(), pref_food, pref_shop } = params;

    // 1. 计算剩余时间
    const departure = new Date(departure_time);
    const remainingMs = departure - now;
    const remainingMin = Math.round(remainingMs / 60000);

    if (remainingMin <= 0) {
      return `您的航班${flight_no}已起飞，请注意机场广播。`;
    }

    // 2. 查找附近设施
    const nearbyPoi = await this._findNearbyPoi(gate, pref_food, pref_shop);

    // 3. 按剩余时间生成建议
    let suggestions = [];
    let actions = [];

    // 登机口提醒
    suggestions.push(`您的航班${flight_no}从${gate}登机口起飞，距离登机还有${remainingMin}分钟。`);

    // 时间紧迫（<20分钟）
    if (remainingMin <= 20) {
      suggestions.push('时间紧迫，建议直接前往登机口。');
      return suggestions.join(' ');
    }

    // 有剩余时间
    if (pref_food && nearbyPoi.restaurant) {
      const r = nearbyPoi.restaurant;
      actions.push(`建议您前往${r.name}用餐，步行约${r.walking_time_min}分钟。`);
    }

    if (pref_shop && nearbyPoi.shop) {
      const s = nearbyPoi.shop;
      actions.push(`您可以去${s.name}逛逛，步行约${s.walking_time_min}分钟。`);
    }

    // 没有明确偏好但有时间，推荐默认选项
    if (!pref_food && !pref_shop && remainingMin >= 30 && nearbyPoi.restaurant) {
      const r = nearbyPoi.restaurant;
      actions.push(`您还有充裕时间，${r.name}就在${gate}附近，步行约${r.walking_time_min}分钟。`);
    }

    if (actions.length === 0 && remainingMin >= 30) {
      actions.push(`您还有${remainingMin}分钟时间，可以在登机口附近休息等候。`);
    }

    // 提醒登机时间
    const boardingMin = remainingMin - 15; // 提前15分钟开始登机
    if (boardingMin > 0) {
      suggestions.push(`${boardingMin}分钟后开始登机，请留意广播通知。`);
    }

    return [...suggestions, ...actions].join(' ');
  }

  /**
   * 查找登机口附近的设施
   */
  async _findNearbyPoi(gate, wantFood, wantShop) {
    const result = { restaurant: null, shop: null, toilet: null };

    try {
      // 查找附近餐厅
      if (wantFood) {
        const [rows] = await this.pool.query(`
          SELECT * FROM airport_poi
          WHERE type = 'restaurant' AND is_active = 1
          AND (nearby_gates LIKE ? OR 1=1)
          ORDER BY walking_time_min ASC
          LIMIT 1
        `, [`%${gate}%`]);

        if (rows.length > 0) result.restaurant = rows[0];
      }

      // 查找附近商店
      if (wantShop) {
        const [rows] = await this.pool.query(`
          SELECT * FROM airport_poi
          WHERE type = 'shop' AND is_active = 1
          ORDER BY walking_time_min ASC
          LIMIT 1
        `);

        if (rows.length > 0) result.shop = rows[0];
      }

      // 始终查找附近卫生间
      const [toiletRows] = await this.pool.query(`
        SELECT * FROM airport_poi
        WHERE type = 'toilet' AND is_active = 1
        ORDER BY walking_time_min ASC
        LIMIT 1
      `);
      if (toiletRows.length > 0) result.toilet = toiletRows[0];

    } catch (e) {
      console.error('查找附近设施失败:', e);
    }

    return result;
  }
}

module.exports = ItineraryAdvisor;
