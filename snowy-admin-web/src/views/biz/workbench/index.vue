<template>
	<div class="workbench-wrap">
		<a-card :bordered="false" class="mb-3">
			<div class="header-bar">
				<div>
					<div class="title-row">
						<span class="page-title">多角色协同工作台</span>
						<a-tag color="blue">{{ viewLabelMap[activeView] || activeView }}</a-tag>
						<a-tag v-if="overviewData.userInfo?.name" color="cyan">{{ overviewData.userInfo.name }}</a-tag>
					</div>
					<div class="sub-title">
						聚合班主任、任课教师、学工管理、教务管理、教学副院长五维高频审批、课堂考勤与风险处置队列
					</div>
				</div>
				<a-space wrap>
					<a-button @click="openStrategyModal" v-if="hasPerm('bizWorkbenchStrategySave') || activeView === 'vice_dean' || activeView === 'student_admin'">
						<template #icon><setting-outlined /></template>
						防骚扰通知策略
					</a-button>
					<a-button type="primary" :loading="loading" @click="loadOverview()">
						<template #icon><reload-outlined /></template>
						刷新工作台
					</a-button>
				</a-space>
			</div>

			<a-tabs v-model:activeKey="activeView" @change="onViewChange" class="mt-2">
				<a-tab-pane v-for="v in availableViews" :key="v" :tab="viewLabelMap[v] || v" />
			</a-tabs>

			<a-row :gutter="[12, 12]" class="mt-1">
				<a-col :xs="12" :sm="8" :md="4">
					<a-statistic title="在籍学生" :value="stats.totalStudents || 0" />
				</a-col>
				<a-col :xs="12" :sm="8" :md="4">
					<a-statistic title="活跃预警" :value="stats.activeWarnings || 0" :value-style="{ color: '#d46b08' }" />
				</a-col>
				<a-col :xs="12" :sm="8" :md="4">
					<a-statistic title="红/严重预警" :value="stats.severeRedWarnings || 0" :value-style="{ color: '#cf1322' }" />
				</a-col>
				<a-col :xs="12" :sm="8" :md="4">
					<a-statistic title="待指派工单" :value="stats.pendingCases || 0" />
				</a-col>
				<a-col :xs="12" :sm="8" :md="4">
					<a-statistic title="待审请假/补录" :value="(stats.pendingLeaves || 0) + (stats.pendingMakeups || 0)" />
				</a-col>
				<a-col :xs="12" :sm="8" :md="4">
					<a-statistic title="待审申诉/变更" :value="(stats.pendingAppeals || 0) + (stats.pendingChanges || 0)" />
				</a-col>
			</a-row>
		</a-card>

		<!-- 1. 班主任视角 -->
		<template v-if="activeView === 'head_teacher'">
			<a-row :gutter="16">
				<a-col :xs="24" :lg="12">
					<a-card title="待审批学生请假（同意自动同步课堂/日考勤并消除预警）" :bordered="false" class="mb-3">
						<a-table :dataSource="panel.pendingLeaves || []" :pagination="false" size="small" rowKey="id" :loading="loading">
							<a-table-column title="学生" dataIndex="studentName" />
							<a-table-column title="班级" dataIndex="className" />
							<a-table-column title="请假时段" key="range">
								<template #default="{ record }">{{ record.fromDate }} ~ {{ record.toDate }}</template>
							</a-table-column>
							<a-table-column title="操作" key="action" width="130">
								<template #default="{ record }">
									<a-space>
										<a-button type="link" size="small" @click="quickApproveLeave(record, true)">通过</a-button>
										<a-button type="link" danger size="small" @click="quickApproveLeave(record, false)">驳回</a-button>
									</a-space>
								</template>
							</a-table-column>
						</a-table>
					</a-card>
				</a-col>
				<a-col :xs="24" :lg="12">
					<a-card title="待班主任初审转班/学籍变更（初审通过进入副院长终审）" :bordered="false" class="mb-3">
						<a-table :dataSource="panel.pendingClassChanges || []" :pagination="false" size="small" rowKey="id" :loading="loading">
							<a-table-column title="申请人" dataIndex="requesterName" />
							<a-table-column title="原因" dataIndex="reason" ellipsis />
							<a-table-column title="操作" key="action" width="130">
								<template #default="{ record }">
									<a-space>
										<a-button type="link" size="small" @click="quickApproveChange(record, true, false)">初审通过</a-button>
										<a-button type="link" danger size="small" @click="quickApproveChange(record, false, false)">驳回</a-button>
									</a-space>
								</template>
							</a-table-column>
						</a-table>
					</a-card>
				</a-col>
			</a-row>
			<a-card title="我的高风险干预工单" :bordered="false">
				<a-table :dataSource="panel.myCases || []" :pagination="false" size="small" rowKey="id" :loading="loading">
					<a-table-column title="学生" dataIndex="studentName" />
					<a-table-column title="班级" dataIndex="className" />
					<a-table-column title="风险分" dataIndex="riskScore" />
					<a-table-column title="状态" dataIndex="status" />
					<a-table-column title="跳转" key="go">
						<template #default>
							<a-button type="link" size="small" @click="$router.push('/biz/warning-case')">前往工单台账</a-button>
						</template>
					</a-table-column>
				</a-table>
			</a-card>
		</template>

		<!-- 2. 任课教师视角 -->
		<template v-else-if="activeView === 'teacher'">
			<a-row :gutter="16">
				<a-col :xs="24" :lg="12">
					<a-card title="近期授课签到课次" :bordered="false" class="mb-3">
						<template #extra>
							<a-button type="link" size="small" @click="$router.push('/biz/attendance')">进入考勤工作台</a-button>
						</template>
						<a-table :dataSource="panel.recentSessions || []" :pagination="false" size="small" rowKey="id" :loading="loading">
							<a-table-column title="课程" dataIndex="courseName" />
							<a-table-column title="班级" dataIndex="className" />
							<a-table-column title="开始时间" dataIndex="sessionStart" />
							<a-table-column title="状态" dataIndex="status" />
						</a-table>
					</a-card>
				</a-col>
				<a-col :xs="24" :lg="12">
					<a-card title="待审核考勤补录申请（通过自动回填日记录与重算预警）" :bordered="false" class="mb-3">
						<a-table :dataSource="panel.pendingMakeups || []" :pagination="false" size="small" rowKey="id" :loading="loading">
							<a-table-column title="学生" dataIndex="studentName" />
							<a-table-column title="日期" dataIndex="recordDate" />
							<a-table-column title="原因" dataIndex="reason" ellipsis />
							<a-table-column title="操作" key="action" width="130">
								<template #default="{ record }">
									<a-space>
										<a-button type="link" size="small" @click="quickApproveMakeup(record, true)">同意</a-button>
										<a-button type="link" danger size="small" @click="quickApproveMakeup(record, false)">驳回</a-button>
									</a-space>
								</template>
							</a-table-column>
						</a-table>
					</a-card>
				</a-col>
			</a-row>
		</template>

		<!-- 3. 学工管理视角 -->
		<template v-else-if="activeView === 'student_admin'">
			<a-row :gutter="16">
				<a-col :xs="24" :lg="12">
					<a-card title="待处理学生申诉（办结自动关闭关联预警）" :bordered="false" class="mb-3">
						<a-table :dataSource="panel.pendingAppeals || []" :pagination="false" size="small" rowKey="id" :loading="loading">
							<a-table-column title="学生" dataIndex="studentName" />
							<a-table-column title="类型" dataIndex="appealType" />
							<a-table-column title="内容" dataIndex="content" ellipsis />
							<a-table-column title="操作" key="action" width="130">
								<template #default="{ record }">
									<a-space>
										<a-button type="link" size="small" @click="quickHandleAppeal(record, 'resolved')">办结</a-button>
										<a-button type="link" danger size="small" @click="quickHandleAppeal(record, 'rejected')">驳回</a-button>
									</a-space>
								</template>
							</a-table-column>
						</a-table>
					</a-card>
				</a-col>
				<a-col :xs="24" :lg="12">
					<a-card title="待指派高风险干预工单" :bordered="false" class="mb-3">
						<template #extra>
							<a-button type="link" size="small" @click="$router.push('/biz/warning-case')">工单台账</a-button>
						</template>
						<a-table :dataSource="panel.unassignedCases || []" :pagination="false" size="small" rowKey="id" :loading="loading">
							<a-table-column title="学生" dataIndex="studentName" />
							<a-table-column title="班级" dataIndex="className" />
							<a-table-column title="风险分" dataIndex="riskScore" />
							<a-table-column title="状态" dataIndex="status" />
						</a-table>
					</a-card>
				</a-col>
			</a-row>
		</template>

		<!-- 4. 教务管理视角 -->
		<template v-else-if="activeView === 'teaching_admin'">
			<a-row :gutter="16" class="mb-3">
				<a-col :span="8"><a-card size="small"><a-statistic title="课程库" :value="panel.courseCount || 0" /></a-card></a-col>
				<a-col :span="8"><a-card size="small"><a-statistic title="授课开班" :value="panel.courseClassCount || 0" /></a-card></a-col>
				<a-col :span="8"><a-card size="small"><a-statistic title="校历排除日" :value="panel.exclusionCount || 0" /></a-card></a-col>
			</a-row>
			<a-row :gutter="16">
				<a-col :xs="24" :lg="12">
					<a-card title="授课绑定变更队列（通过自动重建教师授课绑定）" :bordered="false">
						<a-table :dataSource="panel.bindingChanges || []" :pagination="false" size="small" rowKey="id" :loading="loading">
							<a-table-column title="申请人" dataIndex="requesterName" />
							<a-table-column title="状态" dataIndex="status" />
							<a-table-column title="操作" key="action" width="130">
								<template #default="{ record }">
									<a-space v-if="record.status !== 'approved' && record.status !== 'rejected'">
										<a-button type="link" size="small" @click="quickApproveChange(record, true, true)">特批生效</a-button>
										<a-button type="link" danger size="small" @click="quickApproveChange(record, false, true)">驳回</a-button>
									</a-space>
									<span v-else>{{ record.status }}</span>
								</template>
							</a-table-column>
						</a-table>
					</a-card>
				</a-col>
				<a-col :xs="24" :lg="12">
					<a-card title="成绩变更申请队列（通过自动回写成绩并重算预警）" :bordered="false">
						<a-table :dataSource="panel.gradeChanges || []" :pagination="false" size="small" rowKey="id" :loading="loading">
							<a-table-column title="申请人" dataIndex="requesterName" />
							<a-table-column title="状态" dataIndex="status" />
							<a-table-column title="操作" key="action" width="130">
								<template #default="{ record }">
									<a-space v-if="record.status !== 'approved' && record.status !== 'rejected'">
										<a-button type="link" size="small" @click="quickApproveChange(record, true, true)">审批生效</a-button>
										<a-button type="link" danger size="small" @click="quickApproveChange(record, false, true)">驳回</a-button>
									</a-space>
									<span v-else>{{ record.status }}</span>
								</template>
							</a-table-column>
						</a-table>
					</a-card>
				</a-col>
			</a-row>
		</template>

		<!-- 5. 教学副院长视角 -->
		<template v-else-if="activeView === 'vice_dean'">
			<a-row :gutter="16">
				<a-col :xs="24" :lg="12">
					<a-card title="待教学副院长特批/终审变更（转班/院系调动/学籍）" :bordered="false" class="mb-3">
						<a-table :dataSource="panel.pendingDeanChanges || []" :pagination="false" size="small" rowKey="id" :loading="loading">
							<a-table-column title="申请人" dataIndex="requesterName" />
							<a-table-column title="类型" dataIndex="targetType" />
							<a-table-column title="原因" dataIndex="reason" ellipsis />
							<a-table-column title="操作" key="action" width="130">
								<template #default="{ record }">
									<a-space>
										<a-button type="link" size="small" @click="quickApproveChange(record, true, true)">特批通过</a-button>
										<a-button type="link" danger size="small" @click="quickApproveChange(record, false, true)">驳回</a-button>
									</a-space>
								</template>
							</a-table-column>
						</a-table>
					</a-card>
				</a-col>
				<a-col :xs="24" :lg="12">
					<a-card title="学院高风险预警处置工单监督" :bordered="false" class="mb-3">
						<template #extra>
							<a-button type="link" size="small" @click="$router.push('/biz/warning')">进入预警中心</a-button>
						</template>
						<a-table :dataSource="panel.highRiskCases || []" :pagination="false" size="small" rowKey="id" :loading="loading">
							<a-table-column title="学生" dataIndex="studentName" />
							<a-table-column title="风险分" dataIndex="riskScore" />
							<a-table-column title="处置人" dataIndex="handlerName" />
							<a-table-column title="状态" dataIndex="status" />
						</a-table>
					</a-card>
				</a-col>
			</a-row>
		</template>

		<a-modal v-model:open="strategyVisible" title="学院通知防骚扰与推送通道策略" @ok="saveStrategy" :confirmLoading="strategySaving">
			<a-form :model="strategyForm" layout="vertical">
				<a-form-item label="学院ID">
					<a-input v-model:value="strategyForm.orgId" disabled />
				</a-form-item>
				<a-row :gutter="12">
					<a-col :span="12"><a-form-item label="启用学院策略"><a-switch v-model:checked="strategyForm.enabled" /></a-form-item></a-col>
					<a-col :span="12"><a-form-item label="预警触发通知"><a-switch v-model:checked="strategyForm.notifyOnCreate" /></a-form-item></a-col>
					<a-col :span="12"><a-form-item label="预警升级通知"><a-switch v-model:checked="strategyForm.notifyOnUpgrade" /></a-form-item></a-col>
					<a-col :span="12"><a-form-item label="预警关闭通知"><a-switch v-model:checked="strategyForm.notifyOnClose" /></a-form-item></a-col>
					<a-col :span="12"><a-form-item label="通知学生"><a-switch v-model:checked="strategyForm.notifyStudent" /></a-form-item></a-col>
					<a-col :span="12"><a-form-item label="通知班主任"><a-switch v-model:checked="strategyForm.notifyHeadTeacher" /></a-form-item></a-col>
					<a-col :span="12"><a-form-item label="通知学工/辅导员"><a-switch v-model:checked="strategyForm.notifyCounselor" /></a-form-item></a-col>
					<a-col :span="12"><a-form-item label="通知家长"><a-switch v-model:checked="strategyForm.notifyParents" /></a-form-item></a-col>
				</a-row>
				<a-form-item label="推送通道">
					<a-checkbox-group v-model:value="strategyForm.channels" :options="[
						{ label: '微信服务号/小程序', value: 'wechat' },
						{ label: '邮件通知', value: 'email' },
						{ label: '短信网关', value: 'sms' }
					]" />
				</a-form-item>
			</a-form>
		</a-modal>
	</div>
</template>

<script setup name="bizWorkbench">
import { message, Modal } from 'ant-design-vue'
import { ReloadOutlined, SettingOutlined } from '@ant-design/icons-vue'
import bizWorkbenchApi from '@/api/biz/bizWorkbenchApi'
import bizLeaveRequestApi from '@/api/biz/bizLeaveRequestApi'
import bizMakeupRequestApi from '@/api/biz/bizMakeupRequestApi'
import bizAppealApi from '@/api/biz/bizAppealApi'
import bizChangeRequestApi from '@/api/biz/bizChangeRequestApi'

const viewLabelMap = {
	vice_dean: '教学副院长',
	teaching_admin: '教务管理',
	student_admin: '学工管理',
	head_teacher: '班主任',
	teacher: '任课教师'
}

const loading = ref(false)
const activeView = ref('head_teacher')
const availableViews = ref(['head_teacher'])
const overviewData = ref({})
const stats = computed(() => overviewData.value.stats || {})
const panel = computed(() => overviewData.value.rolePanel || {})

const strategyVisible = ref(false)
const strategySaving = ref(false)
const strategyForm = reactive({
	orgId: '',
	enabled: true,
	notifyOnCreate: true,
	notifyOnUpgrade: true,
	notifyOnClose: true,
	notifyStudent: true,
	notifyHeadTeacher: true,
	notifyCounselor: true,
	notifyParents: false,
	channels: ['wechat', 'email']
})

const loadOverview = async (viewRole) => {
	loading.value = true
	try {
		const res = await bizWorkbenchApi.overview(viewRole ? { viewRole } : {})
		overviewData.value = res || {}
		availableViews.value = res?.availableViews || ['teacher']
		activeView.value = res?.activeView || availableViews.value[0]
	} finally {
		loading.value = false
	}
}

const onViewChange = (key) => {
	loadOverview(key)
}

const quickApproveLeave = (record, approve) => {
	bizLeaveRequestApi
		.leaveRequestApprove({
			id: record.id,
			approve,
			rejectReason: approve ? '' : '工作台驳回'
		})
		.then(() => {
			message.success(approve ? '请假已通过并同步考勤与预警' : '请假已驳回')
			loadOverview(activeView.value)
		})
}

const quickApproveMakeup = (record, approve) => {
	bizMakeupRequestApi
		.makeupRequestApprove({
			id: record.id,
			approve,
			rejectReason: approve ? '' : '工作台驳回'
		})
		.then(() => {
			message.success(approve ? '补录已通过并回填考勤记录' : '补录已驳回')
			loadOverview(activeView.value)
		})
}

const quickHandleAppeal = (record, status) => {
	bizAppealApi
		.appealHandle({
			id: record.id,
			status,
			resultNote: status === 'resolved' ? '工作台核验办结' : '工作台核验驳回'
		})
		.then(() => {
			message.success(status === 'resolved' ? '申诉已办结' : '申诉已驳回')
			loadOverview(activeView.value)
		})
}

const quickApproveChange = (record, approve, isSpecial) => {
	const reqPromise = isSpecial
		? bizWorkbenchApi.specialApproveChange({
			id: record.id,
			approve,
			note: approve ? '工作台特批终审通过' : '工作台特批驳回'
		})
		: bizChangeRequestApi.changeRequestApprove({
			id: record.id,
			approve,
			rejectReason: approve ? '' : '工作台审批驳回'
		})
	reqPromise.then(() => {
		message.success(approve ? '变更申请审批已提交' : '变更申请已驳回')
		loadOverview(activeView.value)
	})
}

const openStrategyModal = async () => {
	const current = overviewData.value.notificationStrategy || (await bizWorkbenchApi.getNotificationStrategy())
	Object.assign(strategyForm, {
		orgId: current.orgId || '',
		enabled: current.enabled ?? true,
		notifyOnCreate: current.notifyOnCreate ?? true,
		notifyOnUpgrade: current.notifyOnUpgrade ?? true,
		notifyOnClose: current.notifyOnClose ?? true,
		notifyStudent: current.notifyStudent ?? true,
		notifyHeadTeacher: current.notifyHeadTeacher ?? true,
		notifyCounselor: current.notifyCounselor ?? true,
		notifyParents: current.notifyParents ?? false,
		channels: Array.isArray(current.channels) ? [...current.channels] : ['wechat', 'email']
	})
	strategyVisible.value = true
}

const saveStrategy = async () => {
	strategySaving.value = true
	try {
		await bizWorkbenchApi.saveNotificationStrategy({ ...strategyForm })
		message.success('学院防骚扰策略已保存')
		strategyVisible.value = false
		loadOverview(activeView.value)
	} finally {
		strategySaving.value = false
	}
}

onMounted(() => {
	loadOverview()
})
</script>

<style scoped>
.workbench-wrap {
	padding: 4px;
}
.header-bar {
	display: flex;
	justify-content: space-between;
	align-items: center;
	flex-wrap: wrap;
	gap: 12px;
}
.title-row {
	display: flex;
	align-items: center;
	gap: 8px;
}
.page-title {
	font-size: 18px;
	font-weight: 600;
}
.sub-title {
	margin-top: 4px;
	color: #666;
	font-size: 12px;
}
.mb-3 {
	margin-bottom: 12px;
}
.mt-1 {
	margin-top: 8px;
}
.mt-2 {
	margin-top: 12px;
}
</style>
