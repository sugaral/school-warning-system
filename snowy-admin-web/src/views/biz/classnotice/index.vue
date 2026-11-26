<template>
	<a-card :bordered="false">
		<a-form ref="searchFormRef" :model="searchFormState">
			<a-row :gutter="10">
				<a-col :xs="24" :sm="7" :md="7" :lg="7" :xl="7">
					<a-form-item name="classId" label="班级">
						<a-select
							v-model:value="searchFormState.classId"
							:options="classOptions"
							:field-names="{ label: 'className', value: 'id' }"
							placeholder="全部班级"
							show-search
							option-filter-prop="className"
							allow-clear
						/>
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="9" :md="9" :lg="9" :xl="9">
					<a-form-item name="searchKey" label="关键词">
						<a-input v-model:value="searchFormState.searchKey" placeholder="公告标题/内容/发布人" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="8" :md="8" :lg="8" :xl="8">
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
					<a-button type="primary" @click="formRef.onOpen()" v-if="hasPerm('bizClassNoticeAdd')">
						<template #icon><plus-outlined /></template>
						发布公告
					</a-button>
					<xn-batch-button
						v-if="hasPerm('bizClassNoticeBatchDelete')"
						buttonName="批量删除"
						icon="DeleteOutlined"
						buttonDanger
						:selectedRowKeys="selectedRowKeys"
						@batchCallBack="deleteBatch"
					/>
				</a-space>
			</template>
			<template #bodyCell="{ column, record }">
				<template v-if="column.dataIndex === 'readRate'">
					<a-tag color="blue">{{ record.readCount || 0 }} / {{ record.totalStudents || 0 }}</a-tag>
				</template>
				<template v-if="column.dataIndex === 'action'">
					<a-space size="small">
						<a @click="openReadModal(record)" v-if="hasPerm('bizClassNoticeReadStats')">已读明细</a>
						<a @click="formRef.onOpen(record)" v-if="hasPerm('bizClassNoticeEdit')">编辑</a>
						<a-popconfirm title="确定删除该班级公告？" @confirm="removeOne(record)">
							<a-button type="link" danger size="small" v-if="hasPerm('bizClassNoticeDelete')">删除</a-button>
						</a-popconfirm>
					</a-space>
				</template>
			</template>
		</s-table>
	</a-card>
	<Form ref="formRef" @successful="tableRef.refresh(true)" />
	<a-drawer v-model:open="readVisible" title="班级公告已读明细统计" :width="560" :destroy-on-close="true">
		<a-descriptions v-if="readData" size="small" bordered :column="3" style="margin-bottom: 12px">
			<a-descriptions-item label="班级人数">{{ readData.totalStudents }}</a-descriptions-item>
			<a-descriptions-item label="已读人数">
				<span style="color: #52c41a">{{ readData.readCount }}</span>
			</a-descriptions-item>
			<a-descriptions-item label="未读人数">
				<span style="color: #fa8c16">{{ readData.unreadCount }}</span>
			</a-descriptions-item>
		</a-descriptions>
		<a-table
			v-if="readData"
			size="small"
			:columns="[
				{ title: '学号', dataIndex: 'studentNo' },
				{ title: '姓名', dataIndex: 'studentName' },
				{ title: '阅读时间', dataIndex: 'readAt' }
			]"
			:data-source="readData.readers || []"
			:pagination="{ pageSize: 10 }"
			row-key="studentId"
		/>
	</a-drawer>
</template>

<script setup name="bizClassNotice">
	import bizClassNoticeApi from '@/api/biz/bizClassNoticeApi'
	import bizClassApi from '@/api/biz/bizClassApi'
	import Form from './form.vue'

	const columns = [
		{ title: '所属学院', dataIndex: 'orgName' },
		{ title: '目标班级', dataIndex: 'className' },
		{ title: '公告标题', dataIndex: 'title' },
		{ title: '发布人', dataIndex: 'publisherName' },
		{ title: '已读/总人数', dataIndex: 'readRate' },
		{ title: '发布时间', dataIndex: 'createTime' }
	]
	if (hasPerm(['bizClassNoticeReadStats', 'bizClassNoticeEdit', 'bizClassNoticeDelete'])) {
		columns.push({ title: '操作', dataIndex: 'action', align: 'center', fixed: 'right', width: 200 })
	}

	const tableRef = ref(null)
	const formRef = ref()
	const searchFormRef = ref()
	const searchFormState = ref({})
	const classOptions = ref([])
	const selectedRowKeys = ref([])
	const options = {
		rowSelection: {
			onChange: (keys) => {
				selectedRowKeys.value = keys
			}
		}
	}

	const readVisible = ref(false)
	const readData = ref(null)

	bizClassApi.clazzList().then((res) => {
		classOptions.value = res || []
	})

	const openReadModal = (record) => {
		readData.value = null
		readVisible.value = true
		bizClassNoticeApi.noticeReadStats({ id: record.id }).then((res) => {
			readData.value = res
		})
	}

	const loadData = (parameter) => bizClassNoticeApi.noticePage(Object.assign(parameter, searchFormState.value))

	const reset = () => {
		searchFormRef.value.resetFields()
		tableRef.value.refresh(true)
	}

	const removeOne = (record) => {
		bizClassNoticeApi.noticeDelete([{ id: record.id }]).then(() => tableRef.value.refresh(true))
	}

	const deleteBatch = (params) => {
		bizClassNoticeApi.noticeDelete(params).then(() => tableRef.value.clearRefreshSelected())
	}
</script>
