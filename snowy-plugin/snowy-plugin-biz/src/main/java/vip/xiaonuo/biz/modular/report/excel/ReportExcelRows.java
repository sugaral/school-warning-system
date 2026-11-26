package vip.xiaonuo.biz.modular.report.excel;

import com.alibaba.excel.annotation.ExcelProperty;
import lombok.Getter;
import lombok.Setter;

/**
 * EasyExcel 各类导出行结构
 *
 * @author migration-bot
 * @date 2026/11/25
 */
public class ReportExcelRows {

    @Getter
    @Setter
    public static class DailyRow {
        @ExcelProperty("日期")
        private String recordDate;
        @ExcelProperty("学号")
        private String studentNo;
        @ExcelProperty("姓名")
        private String studentName;
        @ExcelProperty("班级")
        private String className;
        @ExcelProperty("课程")
        private String courseName;
        @ExcelProperty("出勤状态")
        private String attendanceStatus;
        @ExcelProperty("作业状态")
        private String homeworkStatus;
        @ExcelProperty("课堂表现")
        private String classBehavior;
        @ExcelProperty("来源")
        private String source;
    }

    @Getter
    @Setter
    public static class WeeklyRow {
        @ExcelProperty("学号")
        private String studentNo;
        @ExcelProperty("姓名")
        private String studentName;
        @ExcelProperty("班级")
        private String className;
        @ExcelProperty("周开始")
        private String weekStart;
        @ExcelProperty("周结束")
        private String weekEnd;
        @ExcelProperty("缺勤次数")
        private Integer absentCount;
        @ExcelProperty("迟到次数")
        private Integer lateCount;
        @ExcelProperty("未交作业次数")
        private Integer homeworkNotSubmitCount;
    }

    @Getter
    @Setter
    public static class MonthlyRow {
        @ExcelProperty("学号")
        private String studentNo;
        @ExcelProperty("姓名")
        private String studentName;
        @ExcelProperty("班级")
        private String className;
        @ExcelProperty("年份")
        private Integer year;
        @ExcelProperty("月份")
        private Integer month;
        @ExcelProperty("缺勤次数")
        private Integer absentCount;
        @ExcelProperty("迟到次数")
        private Integer lateCount;
        @ExcelProperty("未交作业次数")
        private Integer homeworkNotSubmitCount;
    }

    @Getter
    @Setter
    public static class SemesterRow {
        @ExcelProperty("学期")
        private String termCode;
        @ExcelProperty("学号")
        private String studentNo;
        @ExcelProperty("姓名")
        private String studentName;
        @ExcelProperty("班级")
        private String className;
        @ExcelProperty("挂科门数")
        private Integer failedCourseCount;
        @ExcelProperty("已获学分")
        private String earnedCredits;
        @ExcelProperty("应修学分")
        private String requiredCredits;
        @ExcelProperty("平均绩点")
        private String gpa;
    }

    @Getter
    @Setter
    public static class StudentAccountRow {
        @ExcelProperty("学号(登录账号)")
        private String studentNo;
        @ExcelProperty("姓名")
        private String studentName;
        @ExcelProperty("学院")
        private String orgName;
        @ExcelProperty("班级")
        private String className;
        @ExcelProperty("专业")
        private String major;
        @ExcelProperty("入学年份")
        private Integer enrollYear;
        @ExcelProperty("学籍状态")
        private String status;
        @ExcelProperty("初始密码")
        private String initialPassword;
    }
}
