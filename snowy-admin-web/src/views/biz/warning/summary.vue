<template>
	<a-card :bordered="false">
		<div style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px">
			<a-space>
				<a-input v-model:value="termCodeFilter" placeholder="学期编码 如 2025-2026-1" style="width: 200px" allow-clear />
				<a-button type="primary" @click="refreshCurrent">查询当前视图</a-button>
			</a-space>
			<a-popconfirm title="确定依据当前考勤日记录与成绩重算本周、本月及本学期汇总？" @confirm="rebuildAll">
				<a-button type="primary" :loading="rebuilding" v-if="hasPerm('bizWarningSummaryRebuild')">重算周/月/学期汇总</a-button>
			</a-popconfirm>
		</div>
		<a-tabs v-model:activeKey="activeTab" @change="refreshCurrent">
			<a-tab-pane key="studentSnap" tab="学生预警快照">
				<s-table ref="studentSnapRef" :columns="stuSnapCols" :data="(p) => bizWarningApi.studentSnapshots(p)" bordered :row-key="(r) => r.id" :scroll="{ x: 'max-content' }" />
			</a-tab-pane>
			<a-tab-pane key="classSnap" tab="班级监控快照">
				<s-table ref="classSnapRef" :columns="clsSnapCols" :data="(p) => bizWarningApi.classSnapshots(p)" bordered :row-key="(r) => r.id" :scroll="{ x: 'max-content' }" />
			</a-tab-pane>
			<a-tab-pane key="weekly" tab="周度考勤作业汇总">
				<s-table ref="weeklyRef" :columns="weeklyCols" :data="(p) => bizWarningApi.weeklySummary(p)" bordered :row-key="(r) => r.id" :scroll="{ x: 'max-content' }" />
			</a-tab-pane>
			<a-tab-pane key="monthly" tab="月度考勤作业汇总">
				<s-table ref="monthlyRef" :columns="monthlyCols" :data="(p) => bizWarningApi.monthlySummary(p)" bordered :row-key="(r) => r.id" :scroll="{ x: 'max-content' }" />
			</a-tab-pane>
			<a-tab-pane key="term" tab="学期学业汇总">
				<s-table ref="termRef" :columns="termCols" :data="(p) => bizWarningApi.termSummary(Object.assign(p, termCodeFilter ? { termCode: termCodeFilter } : {}))" bordered :row-key="(r) => r.id" :scroll="{ x: 'max-content' }" />
			</a-tab-pane>
		</a-tabs>
	</a-card>
</template>

<script setup name="bizWarningSummary">
	import { message } from 'ant-design-vue'
	import bizWarningApi from '@/api/biz/bizWarningApi'

	const activeTab = ref('studentSnap')
	const termCodeFilter = ref('')
	const rebuilding = ref(false)
	const studentSnapRef = ref()
	const classSnapRef = ref()
	const weeklyRef = ref()
	const monthlyRef = ref()
	const termRef = ref()

	const stuSnapCols = [
		{ title: '学号', dataIndex: 'studentNo' },
		{ title: '姓名', dataIndex: 'studentName' },
		{ title: '班级', dataIndex: 'className' },
		{ title: '当前活跃预警', dataIndex: 'activeWarningCount' },
		{ title: '当前最高等级', dataIndex: 'activeHighestLevel' },
		{ title: '已关闭预警', dataIndex: 'closedWarningCount' },
		{ title: '累计预警总数', dataIndex: 'allWarningCount' },
		{ title: '本周预警', dataIndex: 'weekWarningTotal' },
		{ title: '本月预警', dataIndex: 'monthWarningTotal' }
	]
	const clsSnapCols = [
		{ title: '学院', dataIndex: 'orgName' },
		{ title: '班级', dataIndex: 'className' },
		{ title: '在籍人数', dataIndex: 'totalStudents' },
		{ title: '活跃预警数', dataIndex: 'warningCount' },
		{ title: '红/严重预警数', dataIndex: 'redWarningCount' },
		{ title: '当前请假数', dataIndex: 'leaveCount' }
	]
	const weeklyCols = [
		{ title: '学号', dataIndex: 'studentNo' },
		{ title: '姓名', dataIndex: 'studentName' },
		{ title: '班级', dataIndex: 'className' },
		{ title: '周开始', dataIndex: 'weekStart' },
		{ title: '周结束', dataIndex: 'weekEnd' },
		{ title: '迟到', dataIndex: 'lateCount' },
		{ title: '缺勤', dataIndex: 'absentCount' },
		{ title: '未交作业', dataIndex: 'homeworkNotSubmitCount' }
	]
	const monthlyCols = [
		{ title: '学号', dataIndex: 'studentNo' },
		{ title: '姓名', dataIndex: 'studentName' },
		{ title: '班级', dataIndex: 'className' },
		{ title: '年份', dataIndex: 'year' },
		{ title: '月份', dataIndex: 'month' },
		{ title: '迟到', dataIndex: 'lateCount' },
		{ title: '缺勤', dataIndex: 'absentCount' },
		{ title: '未交作业', dataIndex: 'homeworkNotSubmitCount' }
	]
	const termCols = [
		{ title: '学号', dataIndex: 'studentNo' },
		{ title: '姓名', dataIndex: 'studentName' },
		{ title: '班级', dataIndex: 'className' },
		{ title: '学期编码', dataIndex: 'termCode' },
		{ title: '挂科门数', dataIndex: 'failedCourseCount' },
		{ title: '已获学分', dataIndex: 'earnedCredits' },
		{ title: '应修学分', dataIndex: 'requiredCredits' },
		{ title: 'GPA', dataIndex: 'gpa' }
	]

	const refreshCurrent = () => {
		const map = { studentSnap: studentSnapRef, classSnap: classSnapRef, weekly: weeklyRef, monthly: monthlyRef, term: termRef }
		map[activeTab.value]?.value?.refresh(true)
	}

	const rebuildAll = () => {
		rebuilding.value = true
		bizWarningApi
			.rebuildSummary({ termCode: termCodeFilter.value || undefined })
			.then((res) => {
				message.success(`汇总重算完成：周 ${res?.weeklyUpserted ?? 0} 人，月 ${res?.monthlyUpserted ?? 0} 人，学期 ${res?.termUpserted ?? 0} 人`)
				refreshCurrent()
			})
			.finally(() => {
				rebuilding.value = false
			})
	}
</script>
