<template>
	<div>
		<a-card :bordered="false" class="mb-3">
			<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
				<div>
					<span style="font-size:18px;font-weight:600;margin-right:10px;">学业预警统计与监控大屏</span>
					<a-tag color="blue">{{ viewLabels[viewType] || viewType }}</a-tag>
				</div>
				<a-space>
					<a-radio-group v-model:value="viewType" button-style="solid" @change="loadDashboard">
						<a-radio-button v-for="v in availableViews" :key="v" :value="v">{{ viewLabels[v] || v }}</a-radio-button>
					</a-radio-group>
					<a-button type="primary" :loading="loading" @click="loadDashboard">刷新指标</a-button>
				</a-space>
			</div>

			<a-row :gutter="[12, 12]" class="mt-3">
				<a-col :xs="12" :sm="8" :md="4"><a-statistic title="覆盖学生总数" :value="kpi.totalStudents || 0" /></a-col>
				<a-col :xs="12" :sm="8" :md="4"><a-statistic title="当前活跃预警" :value="kpi.activeWarnings || 0" :value-style="{ color: '#d46b08' }" /></a-col>
				<a-col :xs="12" :sm="8" :md="4"><a-statistic title="红/严重预警" :value="kpi.redSevereWarnings || 0" :value-style="{ color: '#cf1322' }" /></a-col>
				<a-col :xs="12" :sm="8" :md="4"><a-statistic title="进行中干预工单" :value="kpi.activeCases || 0" /></a-col>
				<a-col :xs="12" :sm="8" :md="4"><a-statistic title="已批准请假次数" :value="kpi.approvedLeaves || 0" /></a-col>
				<a-col :xs="12" :sm="8" :md="4"><a-statistic title="待分发通知任务" :value="kpi.queuedNotifyJobs || 0" /></a-col>
			</a-row>
		</a-card>

		<a-row :gutter="16" class="mb-3">
			<a-col :xs="24" :lg="12">
				<a-card title="活跃预警等级分布" :bordered="false">
					<div ref="levelChartRef" style="height:300px;width:100%;"></div>
				</a-card>
			</a-col>
			<a-col :xs="24" :lg="12">
				<a-card title="触发指标分类统计" :bordered="false">
					<div ref="metricChartRef" style="height:300px;width:100%;"></div>
				</a-card>
			</a-col>
		</a-row>

		<a-row :gutter="16" class="mb-3">
			<a-col :xs="24" :lg="12">
				<a-card title="学院学生与活跃预警对比" :bordered="false">
					<div ref="orgChartRef" style="height:320px;width:100%;"></div>
				</a-card>
			</a-col>
			<a-col :xs="24" :lg="12">
				<a-card title="近8周缺勤 / 迟到 / 缺交作业趋势" :bordered="false">
					<div ref="trendChartRef" style="height:320px;width:100%;"></div>
				</a-card>
			</a-col>
		</a-row>

		<a-card title="高风险班级预警看板排行" :bordered="false">
			<a-table :dataSource="classTopWarnings" :pagination="false" size="small" rowKey="id" :loading="loading">
				<a-table-column title="班级" dataIndex="className" />
				<a-table-column title="在籍人数" dataIndex="totalStudents" />
				<a-table-column title="活跃预警人次" dataIndex="warningCount" />
				<a-table-column title="红/严重预警人次" dataIndex="redWarningCount" />
				<a-table-column title="请假人次" dataIndex="leaveCount" />
			</a-table>
		</a-card>
	</div>
</template>

<script setup name="bizStats">
import * as echarts from 'echarts'
import bizStatsApi from '@/api/biz/bizStatsApi'

const viewLabels = { school: '全校总览视角', org: '学院学工视角', class: '班级班主任视角' }
const loading = ref(false)
const viewType = ref('')
const availableViews = ref(['org', 'class'])
const kpi = ref({})
const classTopWarnings = ref([])

const levelChartRef = ref()
const metricChartRef = ref()
const orgChartRef = ref()
const trendChartRef = ref()
let charts = []

const initOrGet = (el) => {
	if (!el) return null
	const existing = echarts.getInstanceByDom(el)
	if (existing) return existing
	const c = echarts.init(el)
	charts.push(c)
	return c
}

const renderCharts = (data) => {
	const lvChart = initOrGet(levelChartRef.value)
	lvChart?.setOption({
		tooltip: { trigger: 'item' },
		legend: { bottom: 0 },
		color: ['#faad14', '#fa8c16', '#f5222d', '#722ed1'],
		series: [{
			type: 'pie',
			radius: ['42%', '70%'],
			data: (data.levelDistribution || []).map((i) => ({ name: i.name, value: i.value }))
		}]
	})

	const mtChart = initOrGet(metricChartRef.value)
	const metrics = data.metricDistribution || []
	mtChart?.setOption({
		tooltip: { trigger: 'axis' },
		xAxis: { type: 'category', data: metrics.map((m) => m.name) },
		yAxis: { type: 'value' },
		series: [{ type: 'bar', data: metrics.map((m) => m.value), itemStyle: { color: '#1677ff' } }]
	})

	const orgChart = initOrGet(orgChartRef.value)
	const orgs = data.orgComparison || []
	orgChart?.setOption({
		tooltip: { trigger: 'axis' },
		legend: { data: ['在籍学生', '活跃预警'] },
		xAxis: { type: 'category', data: orgs.map((o) => o.orgName), axisLabel: { interval: 0, rotate: 15 } },
		yAxis: { type: 'value' },
		series: [
			{ name: '在籍学生', type: 'bar', data: orgs.map((o) => o.studentCount) },
			{ name: '活跃预警', type: 'bar', data: orgs.map((o) => o.warningCount), itemStyle: { color: '#ff4d4f' } }
		]
	})

	const trChart = initOrGet(trendChartRef.value)
	const trend = data.weeklyTrend || []
	trChart?.setOption({
		tooltip: { trigger: 'axis' },
		legend: { data: ['缺勤', '迟到', '作业未交'] },
		xAxis: { type: 'category', data: trend.map((t) => t.weekStart) },
		yAxis: { type: 'value' },
		series: [
			{ name: '缺勤', type: 'line', smooth: true, data: trend.map((t) => t.absentCount) },
			{ name: '迟到', type: 'line', smooth: true, data: trend.map((t) => t.lateCount) },
			{ name: '作业未交', type: 'line', smooth: true, data: trend.map((t) => t.homeworkNotSubmitCount) }
		]
	})
}

const loadDashboard = async () => {
	loading.value = true
	try {
		const res = await bizStatsApi.dashboard(viewType.value ? { viewType: viewType.value } : {})
		availableViews.value = res?.availableViews || ['org', 'class']
		viewType.value = res?.viewType || availableViews.value[0]
		kpi.value = res?.kpi || {}
		classTopWarnings.value = res?.classTopWarnings || []
		await nextTick()
		renderCharts(res || {})
	} finally {
		loading.value = false
	}
}

const onResize = () => charts.forEach((c) => c?.resize())

onMounted(() => {
	loadDashboard()
	window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
	window.removeEventListener('resize', onResize)
	charts.forEach((c) => c?.dispose())
	charts = []
})
</script>

<style scoped>
.mb-3 { margin-bottom: 12px; }
.mt-3 { margin-top: 12px; }
</style>
