/*
 * Copyright [2022] [https://www.xiaonuo.vip]
 *
 * Snowy采用APACHE LICENSE 2.0开源协议，您在使用过程中，需要注意以下几点：
 *
 * 1.请不要删除和修改根目录下的LICENSE文件。
 * 2.请不要删除和修改Snowy源码头部的版权声明。
 * 3.本项目代码可免费商业使用，商业使用请保留源码和相关描述文件的项目出处，作者声明等。
 * 4.分发源码时候，请注明软件出处 https://www.xiaonuo.vip
 * 5.不可二次分发开源参与同类竞品，如有想法可联系团队xiaonuobase@qq.com商议合作。
 * 6.若您的项目无法满足以上几点，需要更多功能代码，获取Snowy商业授权许可，请在官网购买授权，地址为 https://www.xiaonuo.vip
 */
package vip.xiaonuo.biz.core.util;

import cn.hutool.core.util.ObjectUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.support.SFunction;
import vip.xiaonuo.auth.core.util.StpLoginUserUtil;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.util.CommonSqlUtil;

import java.util.List;

/**
 * 业务模块数据范围校验工具
 *
 * @author migration-bot
 * @date 2026/11/25
 */
public final class BizScopeUtil {

    private BizScopeUtil() {
    }

    /**
     * 获取当前登录B端用户的数据范围机构ID集合；null表示不受机构限制（超管/全局）
     */
    public static List<String> getDataScope() {
        return StpLoginUserUtil.getLoginUserDataScope();
    }

    /**
     * 当前用户是否被授予空数据范围（无任何可访问机构）
     */
    public static boolean isEmptyScope(List<String> scope) {
        return scope != null && scope.isEmpty();
    }

    /**
     * 校验目标机构是否在当前用户数据范围内，不在则直接阻断
     */
    public static void assertOrgInScope(String orgId, String actionDesc) {
        List<String> scope = getDataScope();
        if (isEmptyScope(scope) || (ObjectUtil.isNotEmpty(scope) && !scope.contains(orgId))) {
            throw new CommonException("您没有权限在机构 {} 下{}", orgId, actionDesc);
        }
    }

    /**
     * 为查询条件注入机构数据范围过滤；若范围为空返回false表示应直接返回空集
     */
    public static <T> boolean applyOrgScope(LambdaQueryWrapper<T> wrapper, SFunction<T, ?> orgIdCol) {
        List<String> scope = getDataScope();
        if (isEmptyScope(scope)) {
            return false;
        }
        if (ObjectUtil.isNotEmpty(scope)) {
            CommonSqlUtil.safeIn(wrapper, orgIdCol, scope);
        }
        return true;
    }
}
