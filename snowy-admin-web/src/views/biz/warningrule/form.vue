<template>
	<xn-form-container
		:title="formData.id ? '编辑预警规则（保存将递增版本号）' : '新增预警规则'"
		:width="560"
		:visible="visible"
		:destroy-on-close="true"
		@close="onClose"
	>
		<a-form ref="formRef" :model="formData" :rules="formRules" layout="vertical">
			<a-form-item label="规则作用域：" name="scope">
				<a-radio-group v-model:value="formData.scope" :disabled="!!formData.id">
					<a-radio value="school">全校默认规则</a-radio>
					<a-radio value="college">学院覆盖规则</a-radio>
				</a-radio-group>
			</a-form-item>
			<a-form-item v-if="formData.scope === 'college'" label="所属学院：" name="scopeId">
				<a-tree-select
					v-model:value="formData.scopeId"
					class="xn-wd"
					placeholder="请选择学院"
					:tree-data="treeData"
					:field-names="{ children: 'children', label: 'name', value: 'id' }"
					:disabled="!!formData.id"
					tree-line
					allow-clear
				/>
			</a-form-item>
			<a-row :gutter="12">
				<a-col :span="12">
					<a-form-item label="统计指标：" name="metric">
						<a-select v-model:value="formData.metric" :options="metricOptions" placeholder="请选择指标" />
					</a-form-item>
				</a-col>
				<a-col :span="12">
					<a-form-item label="统计窗口：" name="windowType">
						<a-select v-model:value="formData.windowType" :options="windowOptions" placeholder="请选择窗口" />
					</a-form-item>
				</a-col>
			</a-row>
			<a-row :gutter="12">
				<a-col :span="12">
					<a-form-item label="预警等级：" name="level">
						<a-select v-model:value="formData.level" :options="levelOptions" placeholder="请选择等级" />
					</a-form-item>
				</a-col>
				<a-col :span="12">
					<a-form-item label="触发阈值（非负整数）：" name="threshold">
						<a-input-number v-model:value="formData.threshold" class="xn-wd" :min="0" />
					</a-form-item>
				</a-col>
			</a-row>
			<a-form-item label="是否启用：" name="enabled">
				<a-switch v-model:checked="formData.enabled" checked-children="启用" un-checked-children="停用" />
			</a-form-item>
			<a-form-item label="通知策略 JSON：" name="notifyStrategyJson">
				<a-textarea v-model:value="formData.notifyStrategyJson" :rows="3" placeholder='{"channels":["email","inbox"],"cooldown_hours":24}' />
			</a-form-item>
		</a-form>
		<template #footer>
			<a-button class="xn-mr8" @click="onClose">关闭</a-button>
			<a-button type="primary" :loading="submitLoading" @click="onSubmit">保存</a-button>
		</template>
	</xn-form-container>
</template>

<script setup name="bizWarningRuleForm">
	import { required } from '@/utils/formRules'
	import bizWarningRuleApi from '@/api/biz/bizWarningRuleApi'

	const emit = defineEmits({ successful: null })

	const metricOptions = [
		{ label: '缺勤次数', value: 'absent' },
		{ label: '迟到次数', value: 'late' },
		{ label: '早退次数', value: 'early_leave' },
		{ label: '请假次数', value: 'leave' },
		{ label: '作业未交', value: 'homework_not_submit' },
		{ label: '作业迟交', value: 'homework_late_submit' },
		{ label: '课堂违纪', value: 'class_behavior' },
		{ label: '累计预警', value: 'warning_total' },
		{ label: '未确认预警', value: 'unacknowledged' },
		{ label: '挂科门数（仅学期）', value: 'failed_courses' },
		{ label: '已修学分×10（仅学期）', value: 'credits' },
		{ label: '平均绩点×100（仅学期）', value: 'gpa' }
	]
	const windowOptions = [
		{ label: '日', value: 'day' },
		{ label: '周', value: 'week' },
		{ label: '月', value: 'month' },
		{ label: '学期', value: 'term' }
	]
	const levelOptions = [
		{ label: '黄色预警', value: 'yellow' },
		{ label: '橙色预警', value: 'orange' },
		{ label: '红色预警', value: 'red' },
		{ label: '严重预警', value: 'severe' }
	]

	const visible = ref(false)
	const formRef = ref()
	const formData = ref({})
	const submitLoading = ref(false)
	const treeData = ref([])

	const formRules = {
		scope: [required('请选择作用域')],
		scopeId: [required('请选择所属学院')],
		metric: [required('请选择统计指标')],
		windowType: [required('请选择统计窗口')],
		level: [required('请选择预警等级')],
		threshold: [required('请输入触发阈值')]
	}

	const onOpen = (record) => {
		visible.value = true
		formData.value = {
			scope: 'school',
			windowType: 'day',
			level: 'yellow',
			threshold: 1,
			enabled: true,
			notifyStrategyJson: '{"channels":["email","inbox"],"cooldown_hours":24}'
		}
		if (record) formData.value = Object.assign({}, record)
		bizWarningRuleApi.orgTreeSelector().then((res) => {
			treeData.value = res || []
		})
	}

	const onClose = () => {
		visible.value = false
	}

	const onSubmit = () => {
		formRef.value
			.validate()
			.then(() => {
				submitLoading.value = true
				bizWarningRuleApi
					.submitForm(formData.value, !!formData.value.id)
					.then(() => {
						visible.value = false
						emit('successful')
					})
					.finally(() => {
						submitLoading.value = false
					})
			})
			.catch(() => {})
	}

	defineExpose({ onOpen })
</script>
