<template>
	<a-card :bordered="false">
		<a-form ref="searchFormRef" :model="searchFormState">
			<a-row :gutter="10">
				<a-col :xs="24" :sm="7" :md="7" :lg="7" :xl="7">
					<a-form-item name="searchKey" label="关键词">
						<a-input v-model:value="searchFormState.searchKey" placeholder="学号 / 姓名" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="6" :md="6" :lg="6" :xl="6">
					<a-form-item name="status" label="工单状态">
						<a-select v-model:value="searchFormState.status" placeholder="全部状态" allow-clear>
							<a-select-option value="pending_assignment">待指派</a-select-option>
							<a-select-option value="assigned">已指派</a-select-option>
							<a-select-option value="in_progress">处置中</a-select-option>
							<a-select-option value="completed">待结案核验</a-select-option>
							<a-select-option value="resolved">已结案</a-select-option>
						</a-select>
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="5" :md="5" :lg="5" :xl="5">
					<a-form-item name="isActive" label="活跃状态">
						<a-select v-model:value="searchFormState.isActive" placeholder="全部" allow-clear>
							<a-select-option :value="1">进行中</a-select-option>
							<a-select-option :value="0">已归档</a-select-option>
						</a-select>
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="6" :md="6" :lg="6" :xl="6">
					<a-form-item>
						<a-space>
							<a-button type="primary" @click="tableRef.refresh(true)">
								<template #icon><SearchOutlined /></template>
								查询
							</a-button>
							<a-button @click="reset">
								<template #icon><redo-outlined /></template>
								重置
							</a-button>
						</a-space>
					</a-form-item>
				</a-col>
			</a-row>
		</a-form>
		<s-table
			ref="tableRef"
			:columns="columns"
			:data="loadData"
			:alert="false"
			bordered
			:tool-config="{ refresh: true, height: true, columnSetting: true }"
			:row-key="(record) => record.id"
			:scroll="{ x: 'max-content' }"
		>
			<template #bodyCell="{ column, record }">
				<template v-if="column.dataIndex === 'riskScore'">
					<a-tag :color="record.riskScore >= 80 ? 'red' : record.riskScore >= 60 ? 'orange' : 'blue'">
						{{ record.riskScore }} 分
					</a-tag>
				</template>
				<template v-if="column.dataIndex === 'status'">
					<a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
				</template>
				<template v-if="column.dataIndex === 'action'">
					<a @click="openDetail(record)">日志与详情</a>
					<template v-if="record.status !== 'resolved'">
						<template v-if="hasPerm('bizWarningCaseAssign')">
							<a-divider type="vertical" />
							<a @click="openAssign(record)">指派</a>
						</template>
						<template v-if="(record.status === 'pending_assignment' || record.status === 'assigned') && hasPerm('bizWarningCaseAccept')">
							<a-divider type="vertical" />
							<a @click="acceptOne(record)">接单</a>
						</template>
						<template v-if="record.status === 'in_progress' && hasPerm('bizWarningCaseComplete')">
							<a-divider type="vertical" />
							<a @click="openHandle(record, 'complete')">提交处置</a>
						</template>
						<template v-if="hasPerm('bizWarningCaseResolve')">
							<a-divider type="vertical" />
							<a @click="openHandle(record, 'resolve')" style="color: #52c41a">结案</a>
						</template>
					</template>
				</template>
			</template>
		</s-table>
	</a-card>
	<a-modal v-model:open="assignVisible" title="指派干预处置人" :confirm-loading="opLoading" @ok="submitAssign">
		<a-form layout="vertical">
			<a-form-item label="处置教师 / 班主任：" required>
				<a-select
					v-model:value="assignPayload.handlerUserId"
					:options="userOptions"
					:field-names="{ label: 'name', value: 'id' }"
					placeholder="请选择处置人"
					show-search
					option-filter-prop="name"
				/>
			</a-form-item>
			<a-form-item label="指派说明：">
				<a-textarea v-model:value="assignPayload.note" :rows="2" placeholder="可选填写指派注意事项" />
			</a-form-item>
		</a-form>
	</a-modal>
	<a-modal
		v-model:open="handleVisible"
		:title="handleMode === 'complete' ? '提交线下干预处置总结' : '核验结案干预工单'"
		:confirm-loading="opLoading"
		@ok="submitHandle"
	>
		<a-form layout="vertical">
			<a-form-item label="处置 / 结案总结：" required>
				<a-textarea v-model:value="handlePayload.completionSummary" :rows="3" placeholder="请输入谈心谈话、家校联系或学业帮扶结果" />
			</a-form-item>
		</a-form>
	</a-modal>
	<a-drawer v-model:open="detailVisible" title="高风险干预工单流转档案" width="600">
		<template v-if="detailRow">
			<a-descriptions bordered :column="2" size="small" style="margin-bottom: 16px">
				<a-descriptions-item label="学生">{{ detailRow.studentNo }} - {{ detailRow.studentName }}</a-descriptions-item>
				<a-descriptions-item label="班级">{{ detailRow.className }}</a-descriptions-item>
				<a-descriptions-item label="风险分">{{ detailRow.riskScore }}</a-descriptions-item>
				<a-descriptions-item label="当前状态">{{ statusLabel(detailRow.status) }}</a-descriptions-item>
				<a-descriptions-item label="当前处置人">{{ detailRow.handlerName || '未指派' }}</a-descriptions-item>
				<a-descriptions-item label="总结">{{ detailRow.completionSummary || '-' }}</a-descriptions-item>
			</a-descriptions>
			<a-timeline>
				<a-timeline-item v-for="log in detailRow.logs || []" :key="log.id">
					<div><b>{{ actionLabel(log.action) }}</b> ｜ {{ log.actorName || '系统' }} ｜ {{ log.createTime }}</div>
					<div style="color: #666">{{ log.note }}</div>
				</a-timeline-item>
			</a-timeline>
		</template>
	</a-drawer>
</template>

<script setup name="bizWarningCase">
	import { message } from 'ant-design-vue'
	import bizWarningApi from '@/api/biz/bizWarningApi'
	import bizClassApi from '@/api/biz/bizClassApi'

	const columns = [
		{ title: '学号', dataIndex: 'studentNo' },
		{ title: '姓名', dataIndex: 'studentName' },
		{ title: '班级', dataIndex: 'className' },
		{ title: '综合风险分', dataIndex: 'riskScore' },
		{ title: '当前处置人', dataIndex: 'handlerName' },
		{ title: '状态', dataIndex: 'status' },
		{ title: '最新预警时间', dataIndex: 'latestWarningAt' },
		{ title: '操作', dataIndex: 'action', align: 'center', fixed: 'right', width: 250 }
	]

	const tableRef = ref(null)
	const searchFormRef = ref()
	const searchFormState = ref({})
	const userOptions = ref([])
	const opLoading = ref(false)
	const assignVisible = ref(false)
	const assignPayload = ref({ id: '', handlerUserId: undefined, note: '' })
	const handleVisible = ref(false)
	const handleMode = ref('complete')
	const handlePayload = ref({ id: '', completionSummary: '' })
	const detailVisible = ref(false)
	const detailRow = ref(null)

	const actionLabel = (a) => ({ create: '系统自动创建', assign: '指派处置人', accept: '接单跟进', complete: '提交处置总结', resolve: '核验结案' }[a] || a)
	const statusLabel = (s) => ({ pending_assignment: '待指派', assigned: '已指派', in_progress: '处置中', completed: '待核验', resolved: '已结案' }[s] || s)
	const statusColor = (s) => ({ pending_assignment: 'orange', assigned: 'blue', in_progress: 'processing', completed: 'cyan', resolved: 'green' }[s] || 'default')

	const loadData = (parameter) => bizWarningApi.casePage(Object.assign(parameter, searchFormState.value))

	const reset = () => {
		searchFormRef.value.resetFields()
		tableRef.value.refresh(true)
	}

	const openAssign = (record) => {
		assignPayload.value = { id: record.id, handlerUserId: record.handlerUserId, note: '' }
		bizClassApi.userSelector({ orgId: record.orgId }).then((data) => {
			userOptions.value = data || []
		})
		assignVisible.value = true
	}

	const submitAssign = () => {
		if (!assignPayload.value.handlerUserId) {
			message.warning('请选择处置人')
			return
		}
		opLoading.value = true
		bizWarningApi
			.caseAssign(assignPayload.value)
			.then(() => {
				assignVisible.value = false
				message.success('工单已指派')
				tableRef.value.refresh(true)
			})
			.finally(() => {
				opLoading.value = false
			})
	}

	const acceptOne = (record) => {
		bizWarningApi.caseAccept({ id: record.id, note: '接单处理' }).then(() => {
			message.success('已接单进入处置中')
			tableRef.value.refresh(true)
		})
	}

	const openHandle = (record, mode) => {
		handleMode.value = mode
		handlePayload.value = { id: record.id, completionSummary: record.completionSummary || '' }
		handleVisible.value = true
	}

	const submitHandle = () => {
		if (!handlePayload.value.completionSummary?.trim()) {
			message.warning('请填写处置或结案说明')
			return
		}
		opLoading.value = true
		const apiCall = handleMode.value === 'complete' ? bizWarningApi.caseComplete : bizWarningApi.caseResolve
		apiCall(handlePayload.value)
			.then(() => {
				handleVisible.value = false
				message.success(handleMode.value === 'complete' ? '已提交处置总结' : '工单已核验结案')
				tableRef.value.refresh(true)
			})
			.finally(() => {
				opLoading.value = false
			})
	}

	const openDetail = (record) => {
		bizWarningApi.caseDetail({ id: record.id }).then((data) => {
			detailRow.value = data
			detailVisible.value = true
		})
	}
</script>
