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
package vip.xiaonuo.biz.modular.warning.param;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;

/**
 * 预警历史分页查询参数
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Getter
@Setter
public class BizWarningPageParam {

    @Schema(description = "当前页")
    private Integer current;

    @Schema(description = "每页条数")
    private Integer size;

    @Schema(description = "班级ID")
    private String classId;

    @Schema(description = "预警指标")
    private String metric;

    @Schema(description = "预警等级(yellow/orange/red/severe)")
    private String level;

    @Schema(description = "统计窗口(day/week/month/term)")
    private String windowType;

    @Schema(description = "状态(open/acknowledged/closed)")
    private String status;

    @Schema(description = "关键词(学号/姓名/触发摘要)")
    private String searchKey;
}
