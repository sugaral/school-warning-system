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
package vip.xiaonuo.biz.modular.student.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;

/**
 * 学生档案Mapper接口
 *
 * @author migration-bot
 * @date 2026/11/25
 */
public interface BizStudentProfileMapper extends BaseMapper<BizStudentProfile> {

    @Delete("DELETE FROM BIZ_STUDENT_NOTIFICATION_READ WHERE STUDENT_ID = #{studentId}")
    void deleteNotificationReadsByStudentId(@Param("studentId") String studentId);

    @Delete("DELETE FROM BIZ_STUDENT_WARNING_SNAPSHOT WHERE STUDENT_ID = #{studentId}")
    void deleteWarningSnapshotsByStudentId(@Param("studentId") String studentId);

    @Delete("DELETE FROM BIZ_WARNING_CURRENT_STATE WHERE STUDENT_ID = #{studentId}")
    void deleteWarningCurrentStatesByStudentId(@Param("studentId") String studentId);

    @Delete("DELETE FROM BIZ_WARNING WHERE STUDENT_ID = #{studentId}")
    void deleteWarningsByStudentId(@Param("studentId") String studentId);

    @Delete("DELETE FROM BIZ_WARNING_CASE WHERE STUDENT_ID = #{studentId}")
    void deleteWarningCasesByStudentId(@Param("studentId") String studentId);

    @Delete("DELETE FROM BIZ_LEAVE_REQUEST WHERE STUDENT_ID = #{studentId}")
    void deleteLeaveRequestsByStudentId(@Param("studentId") String studentId);

    @Delete("DELETE FROM BIZ_MAKEUP_REQUEST WHERE STUDENT_ID = #{studentId}")
    void deleteMakeupRequestsByStudentId(@Param("studentId") String studentId);

    @Delete("DELETE FROM BIZ_APPEAL WHERE STUDENT_ID = #{studentId}")
    void deleteAppealsByStudentId(@Param("studentId") String studentId);

    @Delete("DELETE FROM BIZ_ATTENDANCE_RECORD WHERE STUDENT_ID = #{studentId}")
    void deleteAttendanceRecordsByStudentId(@Param("studentId") String studentId);

    @Delete("DELETE FROM BIZ_DAILY_RECORD WHERE STUDENT_ID = #{studentId}")
    void deleteDailyRecordsByStudentId(@Param("studentId") String studentId);

    @Delete("DELETE FROM BIZ_WEEKLY_SUMMARY WHERE STUDENT_ID = #{studentId}")
    void deleteWeeklySummariesByStudentId(@Param("studentId") String studentId);

    @Delete("DELETE FROM BIZ_MONTHLY_SUMMARY WHERE STUDENT_ID = #{studentId}")
    void deleteMonthlySummariesByStudentId(@Param("studentId") String studentId);

    @Delete("DELETE FROM BIZ_TERM_SUMMARY WHERE STUDENT_ID = #{studentId}")
    void deleteTermSummariesByStudentId(@Param("studentId") String studentId);

    @Delete("DELETE FROM BIZ_GRADE WHERE STUDENT_ID = #{studentId}")
    void deleteGradesByStudentId(@Param("studentId") String studentId);
}
