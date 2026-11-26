<template>
	<a-card :bordered="false">
		<a-form ref="searchFormRef" :model="searchFormState">
			<a-row :gutter="10">
				<a-col :xs="24" :sm="7" :md="7" :lg="7" :xl="7">
					<a-form-item name="searchKey" label="关键词">
						<a-input v-model:value="searchFormState.searchKey" placeholder="原因 / 变更内容 / 目标ID" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="6" :md="6" :lg="6" :xl="6">
					<a-form-item name="targetType" label="变更类型">
						<a-select v-model:value="searchFormState.targetType" :options="TARGET_TYPE_OPTIONS" placeholder="全部类型" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="5" :md="5" :lg="5" :xl="5">
					<a-form-item name="status" label="状态">
						<a-select v-model:value="searchFormState.status" :options="STATUS_OPTIONS" placeholder="全部" allow-clear />
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
			:row-selection="options.rowSelection"
			:scroll="{ x: 'max-content' }"
		>
			<template #operator>
				<a-space>
					<a-button type="primary" @click="formRef.onOpen()" v-if="hasPerm('bizChangeRequestAdd')">
						<template #icon><plus-outlined /></template>
						提交变更
					</a-button>
					<xn-batch-button
						v-if="hasPerm('bizChangeRequestBatchDelete')"
						buttonName="批量删除"
						icon="DeleteOutlined"
						buttonDanger
						:selectedRowKeys="selectedRowKeys"
						@batchCallBack="deleteBatch"
					/>
				</a-space>
			</template>
			<template #bodyCell="{ column, record }">
				<template v-if="column.dataIndex === 'targetType'">
					{{ labelOf(TARGET_TYPE_OPTIONS, record.targetType) }}
				</template>
				<template v-if="column.dataIndex === 'status'">
					<a-tag :color="statusColor(record.status)">{{ labelOf(STATUS_OPTIONS, record.status) }}</a-tag>
				</template>
				<template v-if="column.dataIndex === 'action'">
					<template v-if="hasPerm('bizChangeRequestApprove')">
						<a @click="openApproveModal(record, true)">通过</a>
						<a-divider type="vertical" />
						<a @click="openApproveModal(record, false)" style="color: #fa8c16">驳回</a>
						<a-divider type="vertical" v-if="hasPerm('bizChangeRequestDelete')" />
					</template>
					<a-popconfirm title="确定删除此变更申请？" @confirm="removeOne(record)">
						<a-button type="link" danger size="small" v-if="hasPerm('bizChangeRequestDelete')">删除</a-button>
					</a-popconfirm>
				</template>
			</template>
		</s-table>
	</a-card>
	<Form ref="formRef" @successful="tableRef.refresh(true)" />
	<a-modal
		v-model:open="approveVisible"
		:title="approvePayload.approve ? '确认通过变更申请' : '驳回变更申请'"
		:confirm-loading="approveLoading"
		@ok="submitApprove"
	>
		<p v-if="approvePayload.approve">确认审批通过 {{ approveTarget?.requesterName }} 提交的变更申请？</p>
		<a-form v-else layout="vertical">
			<a-form-item label="驳回原因（必填）：" required>
				<a-textarea v-model:value="approvePayload.rejectReason" :rows="3" placeholder="请输入驳回原因" />
			</a-form-item>
		</a-form>
	</a-modal>
</template>

<script setup name="bizChangeRequest">
	import { message } from 'ant-design-vue'
	import bizChangeRequestApi from '@/api/biz/bizChangeRequestApi'
	import Form from './form.vue'

	const TARGET_TYPE_OPTIONS = [
		{ label: '学生换班申请', value: 'student_profile_class_change' },
		{ label: '学生档案变更', value: 'student_profile' },
		{ label: '教师授课变更', value: 'teacher_course_binding_change' },
		{ label: '教师换院变更', value: 'teacher_org_change' },
		{ label: '成绩变更申请', value: 'grade' }
	]
	const STATUS_OPTIONS = [
		{ label: '已提交', value: 'submitted' },
		{ label: '待班主任审', value: 'pending_head' },
		{ label: '待院长审', value: 'pending_dean' },
		{ label: '待教务审', value: 'pending_admin' },
		{ label: '已通过', value: 'approved' },
		{ label: '已驳回', value: 'rejected' }
	]

	const columns = [
		{ title: '申请人', dataIndex: 'requesterName' },
		{ title: '变更类型', dataIndex: 'targetType' },
		{ title: '目标ID', dataIndex: 'targetId' },
		{ title: '变更内容', dataIndex: 'changeJson', ellipsis: true },
		{ title: '申请原因', dataIndex: 'reason', ellipsis: true },
		{ title: '状态', dataIndex: 'status' },
		{ title: '审批人', dataIndex: 'approverName' },
		{ title: '驳回原因', dataIndex: 'rejectReason', ellipsis: true },
		{ title: '创建时间', dataIndex: 'createTime' }
	]
	if (hasPerm(['bizChangeRequestApprove', 'bizChangeRequestDelete'])) {
		columns.push({ title: '操作', dataIndex: 'action', align: 'center', fixed: 'right', width: 170 })
	}

	const tableRef = ref(null)
	const formRef = ref()
	const searchFormRef = ref()
	const searchFormState = ref({})
	const selectedRowKeys = ref([])

	const approveVisible = ref(false)
	const approveLoading = ref(false)
	const approveTarget = ref(null)
	const approvePayload = ref({ id: '', approve: true, rejectReason: '' })

	const options = {
		rowSelection: {
			onChange: (keys) => {
				selectedRowKeys.value = keys
			}
		}
	}

	const labelOf = (list, val) => list.find((item) => item.value === val)?.label || val
	const statusColor = (s) => (s === 'approved' ? 'green' : s === 'rejected' ? 'red' : 'orange')

	const loadData = (parameter) => bizChangeRequestApi.changeRequestPage(Object.assign(parameter, searchFormState.value))

	const reset = () => {
		searchFormRef.value.resetFields()
		tableRef.value.refresh(true)
	}

	const openApproveModal = (record, approve) => {
		approveTarget.value = record
		approvePayload.value = { id: record.id, approve, rejectReason: '' }
		approveVisible.value = true
	}

	const submitApprove = () => {
		if (!approvePayload.value.approve && !approvePayload.value.rejectReason?.trim()) {
			message.warning('驳回变更申请必须填写驳回原因')
			return
		}
		approveLoading.value = true
		bizChangeRequestApi
			.changeRequestApprove(approvePayload.value)
			.then(() => {
				approveVisible.value = false
				tableRef.value.refresh(true)
			})
			.finally(() => {
				approveLoading.value = false
			})
	}

	const removeOne = (record) => {
		bizChangeRequestApi.changeRequestDelete([{ id: record.id }]).then(() => tableRef.value.refresh(true))
	}

	const deleteBatch = (params) => {
		bizChangeRequestApi.changeRequestDelete(params).then(() => tableRef.value.clearRefreshSelected())
	}
</script>
