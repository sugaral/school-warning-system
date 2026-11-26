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
package vip.xiaonuo.biz.modular.student.result;

import com.alibaba.excel.annotation.ExcelProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;

/**
 * 学生账号密码导出结果
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Getter
@Setter
public class BizStudentAccountExportResult {

    @ExcelProperty("学院")
    @Schema(description = "学院")
    private String orgName;

    @ExcelProperty("班级")
    @Schema(description = "班级")
    private String className;

    @ExcelProperty("学号")
    @Schema(description = "学号")
    private String studentNo;

    @ExcelProperty("姓名")
    @Schema(description = "姓名")
    private String name;

    @ExcelProperty("登录账号")
    @Schema(description = "登录账号")
    private String account;

    @ExcelProperty("初始密码")
    @Schema(description = "初始密码")
    private String initialPassword;

    @ExcelProperty("密码状态")
    @Schema(description = "密码状态")
    private String passwordStatus;
}
